#!/usr/bin/env python3
"""Loads the Kumbh_Mela_2027_V1_07_07 geodatabase (+ Entry_Exist_l.shp) into the
`kumbh` Postgres/PostGIS schema.

Usage:
    python scripts/load_kumbh_2027.py [--dry-run] [--only table1,table2]

Requires: fiona, pyproj, psycopg2-binary (pip install fiona pyproj psycopg2-binary)
Reads POSTGRES_URL from .env.local at repo root.

All source geometry is UTM 44N (EPSG:32644); every `kumbh.*` geom column is
native EPSG:4326, so every feature is reprojected during load.

Behaviour:
- REPLACE tables: existing rows are copied to a `<table>_backup_<date>` table,
  then the target table is truncated and repopulated from the gdb.
- NEW tables: created fresh (id serial PK, GiST index on geom, btree index on
  any sector-like column) if they don't already exist, then populated.
- Prints a per-table row-count summary at the end.
"""

from __future__ import annotations

import argparse
import datetime
import re
import sys
from pathlib import Path

import fiona
import psycopg2
import psycopg2.extras
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import transform as shapely_transform

REPO_ROOT = Path(__file__).resolve().parent.parent
GDB_PATH = REPO_ROOT / "Kumbh_Mela_2027_V1_07_07" / "Kumbh_Mela_2027_V1_07_07.gdb"
ENTRY_EXIST_SHP = REPO_ROOT / "Kumbh_Mela_2027_V1_07_07" / "Entry_Exist_l.shp"

SOURCE_SRID = 32644
TARGET_SRID = 4326
BACKUP_SUFFIX = datetime.date.today().strftime("%Y%m%d")

_transformer = Transformer.from_crs(f"EPSG:{SOURCE_SRID}", f"EPSG:{TARGET_SRID}", always_xy=True)


def reproject(geom):
    """Reprojects a shapely geometry from EPSG:32644 to EPSG:4326."""
    return shapely_transform(lambda x, y, z=None: _transformer.transform(x, y), geom)


def force_2d(geom):
    """Drops Z. Sector_Tertiary_Road is the only 3D source layer in the gdb, but the
    target geometry(..., 4326) columns are always declared 2D, so a 3D insert would
    fail -- applied unconditionally in load_new_table since it's a no-op on 2D geometry."""
    if not geom.has_z:
        return geom
    return shapely_transform(lambda x, y, z=None: (x, y), geom)


def clean(v):
    """Blanks (' ', '', None) all collapse to None; everything else passes through."""
    if v is None:
        return None
    if isinstance(v, str) and v.strip() == "":
        return None
    return v


# ---------------------------------------------------------------------------
# Table specs
#
# Each spec maps a target kumbh table to one or more source gdb layers, plus a
# column-mapping function that takes a source `properties` dict and returns
# the target-column dict (geom handled separately). `mode` is "replace" (table
# already exists, back up + truncate + reload) or "new" (create if missing).
# ---------------------------------------------------------------------------


def _sector_no_from_name(name):
    """Extracts the trailing '-NN' sector number from a free-text sector name
    like 'BAIRAGI CAMP-11' or 'HARIDWAR -21'. Returns None if no trailing
    number is present (e.g. 'PARIPHERAL') -- those rows get their sector_no
    backfilled via a post-load spatial join instead (see backfill_sector_no)."""
    if not name:
        return None
    m = re.search(r"-\s*(\d+)\s*$", name)
    return int(m.group(1)) if m else None


def _sector_plan_map(p, source_layer):
    sector = clean(p.get("Sector"))
    return {
        "class": clean(p.get("Class")),
        "class_group": clean(p.get("Class")),
        "subclass": clean(p.get("Subclass")),
        "area_mark": clean(p.get("Area_Mark")),
        "plot_no": clean(p.get("Plot_No")),
        "block": clean(p.get("Block")),
        "sector": sector,
        "sector_no": _sector_no_from_name(sector),  # nulls backfilled post-load, see backfill_sector_no
        "remark": clean(p.get("Remark")),
        "remark_1": clean(p.get("Remark_1")),
        "label": clean(p.get("Label")),
        "area": p.get("Area"),
        "shape_leng_src": p.get("SHAPE_Length"),
        "shape_area_src": p.get("SHAPE_Area"),
    }


def _sector_boundary_map(p, source_layer):
    return {
        "name": clean(p.get("Name")),
        "sector_no": p.get("Sect_no"),
        "area_hac": p.get("Area_Hac"),
        "shape_leng_src": p.get("Shape_Length"),
        "shape_area_src": p.get("Shape_Area"),
    }


def _road_map(p, source_layer):
    # ROAD_IN_M is the real curated road layer for the 2027 plan -- it alone
    # carries Type ('Existing Road'/'Proposed Road', matching ROAD_TYPE_COLORS
    # in classColors.ts exactly) plus Sector_Name/Kumbh_Land. Road and
    # Secondary_Road (109/55 rows) carry only a bare Name + length and were
    # wrongly used as the primary source in the first load pass -- kept here
    # only as a supplementary named-highway layer, tagged road_class so they
    # stay distinguishable from ROAD_IN_M's project road network.
    if source_layer == "ROAD_IN_M":
        return {
            "road_name": clean(p.get("Road_Name")),
            "row_width_m": None,
            "sector_name": clean(p.get("Sector_Name")),
            "sector_no": None,
            "type": clean(p.get("Type")) or "Existing Road",
            "road_class": "Project",
            "kumbh_land": clean(p.get("Kumbh_Land")),
            "shape_leng_src": p.get("SHAPE_Length"),
        }
    road_class = "Primary" if source_layer == "Road" else "Secondary"
    return {
        "road_name": clean(p.get("Name") or p.get("name")),
        "row_width_m": p.get("ROW"),
        "sector_name": None,
        "sector_no": None,
        "type": "Existing Road",
        "road_class": road_class,
        "kumbh_land": None,
        "shape_leng_src": p.get("SHAPE_Length") or p.get("Shape_Length"),
    }


def _bridge_map(p, source_layer):
    is_temp = source_layer == "Temporary_Bridges"
    return {
        "remark": clean(p.get("Remark") or p.get("Name")),
        "type": clean(p.get("Type")) or ("Temporary" if is_temp else None),
        "mode": clean(p.get("Mode")),
        "is_temporary": is_temp,
        "shape_leng_src": p.get("SHAPE_Length"),
    }


def _ashram_map(p, source_layer):
    return {
        "objectid": None,
        "class": None,
        "sub_class": clean(p.get("Sub_Class")),
        "rd_rly_nam": clean(p.get("Rd_Rly_Nam")),
        "name": clean(p.get("Name")),
        "code": clean(p.get("Code")),
        "ds_code": clean(p.get("DS_Code")),
        "ar": clean(p.get("ar")),
        "land_use": clean(p.get("Land_Use")),
        "unique_ini": clean(p.get("Unique_Ini")),
        "plu_2025": clean(p.get("PLU_2025")),
        "sub_clas_1": clean(p.get("Sub_Clas_1")),
        "shape_leng_src": p.get("Shape_Length"),
        "shape_area_src": p.get("Shape_Area"),
    }


def _river_map(p, source_layer):
    return {
        "objectid": p.get("OBJECTID"),
        "name": clean(p.get("Name")),
        "type": clean(p.get("Type")),
        "shape_leng_src": p.get("Shape_Length"),
        "shape_area_src": p.get("Shape_Area"),
    }


def _ghat_area_map(p, source_layer):
    return {
        "name": clean(p.get("Name")),
        "shape_leng_src": p.get("SHAPE_Length"),
        "shape_area_src": p.get("SHAPE_Area"),
    }


def _kumbh_mela_ghat_map(p, source_layer):
    return {
        "name": clean(p.get("Name")),
        "remark": clean(p.get("Remark")),
        "number": p.get("Number"),
        "lat": p.get("Lat"),
        "long": p.get("Long"),
    }


def _bus_stop_map(p, source_layer):
    return {"name": clean(p.get("Name")), "remark": clean(p.get("Remark"))}


def _bus_terminal_map(p, source_layer):
    return {
        "name": clean(p.get("Name")),
        "shape_leng_src": p.get("SHAPE_Length"),
        "shape_area_src": p.get("SHAPE_Area"),
    }


def _public_service_facilities_map(p, source_layer):
    if source_layer == "FSTP":
        return {
            "name": clean(p.get("Name")),
            "type": "FSTP",
            "subclass": None,
            "services": None,
            "category": None,
            "bed": None,
            "shape_leng_src": p.get("SHAPE_Length"),
            "shape_area_src": p.get("SHAPE_Area"),
        }
    return {
        "name": clean(p.get("Name")),
        "type": clean(p.get("Type")),
        "subclass": clean(p.get("Subclass")),
        "services": None,
        "category": None,
        "bed": None,
        "shape_leng_src": p.get("SHAPE_Length"),
        "shape_area_src": p.get("SHAPE_Area"),
    }


def _sanitation_map(p, source_layer):
    return {
        "oid_src": None,
        "name": clean(p.get("Name")),
        "folder_path": None,
        "class": clean(p.get("Class")),
        "subclass": clean(p.get("Subclass")),
        "sector": clean(p.get("Sector")),
        "remark": clean(p.get("Remark")),
    }


def _amenities_map(p, source_layer):
    return {
        "class": clean(p.get("Class")),
        "subclass": clean(p.get("Subclass")),
        "sector": clean(p.get("Sector")),
        "remark": clean(p.get("Remark")),
    }


def _fh_location_map(p, source_layer):
    return {
        "no": p.get("No"),
        "fh_name": clean(p.get("FH_Name")),
        "type": clean(p.get("Type")),
        "lat": p.get("Lat"),
        "long": p.get("Long"),
    }


def _transformer_map(p, source_layer):
    return {"name": None, "sector": None, "remark": None}


def _kumbh_land_map(p, source_layer):
    return {
        "oid_src": p.get("OID_"),
        "name": clean(p.get("Name")),
        "kumbh_land": clean(p.get("Kumbh_Land")),
        "sector": clean(p.get("Sector")),
        "purpose": clean(p.get("Purpose")),
        "type": clean(p.get("Type")),
        "area": None,
        "shape_leng_src": p.get("Shape_Length"),
        "shape_area_src": p.get("Shape_Area"),
    }


def _core_parking_map(p, source_layer):
    return {
        "oid_src": None,
        "name": clean(p.get("Name_Of_Parking")),
        "kumbh_land": None,
        "sector": clean(p.get("Sector")),
        "purpose": None,
        "type": clean(p.get("Subclass")),
        "area": p.get("Area"),
        "shape_leng_src": None,
        "shape_area_src": None,
    }


def _trench_line_map(p, source_layer):
    return {
        "name": clean(p.get("Name")),
        "remark": clean(p.get("Remark")),
        "shape_leng_src": p.get("SHAPE_Length"),
    }


REPLACE_SPECS = [
    {
        "table": "sector_plan",
        "layers": ["Sector_PLAN_V1"],
        "map": _sector_plan_map,
        "geom_type": "MULTIPOLYGON",
    },
    {
        "table": "sector_boundary",
        "layers": ["SECTOR_BOUNDARY_UPDATED"],
        "map": _sector_boundary_map,
        "geom_type": "MULTIPOLYGON",
    },
    {
        "table": "road",
        "layers": ["ROAD_IN_M", "Road", "Secondary_Road"],
        "map": _road_map,
        "geom_type": "MULTILINESTRING",
        "extra_columns": {"road_class": "text"},
    },
    {
        "table": "bridge",
        "layers": ["BRIDGE", "Temporary_Bridges"],
        "map": _bridge_map,
        "geom_type": "MULTILINESTRING",
        "extra_columns": {"is_temporary": "boolean"},
    },
    {"table": "ashram", "layers": ["Ashram"], "map": _ashram_map, "geom_type": "MULTIPOLYGON"},
    {"table": "river", "layers": ["River"], "map": _river_map, "geom_type": "MULTIPOLYGON"},
    {
        "table": "ghat_area",
        "layers": ["Ghat_Area"],
        "map": _ghat_area_map,
        "geom_type": "MULTIPOLYGON",
    },
    {
        "table": "kumbh_mela_2027_ghat",
        "layers": ["Kumbh_Mela_2027_Ghat"],
        "map": _kumbh_mela_ghat_map,
        "geom_type": "POINT",
    },
    {"table": "bus_stop", "layers": ["Bus_Stop"], "map": _bus_stop_map, "geom_type": "POINT"},
    {
        "table": "bus_terminal",
        "layers": ["Bus_Terminal"],
        "map": _bus_terminal_map,
        "geom_type": "MULTIPOLYGON",
    },
    {
        "table": "public_service_facilities",
        "layers": ["Public_Service_Facilities", "FSTP"],
        "map": _public_service_facilities_map,
        "geom_type": "MULTIPOLYGON",
    },
    {
        "table": "sanitation",
        "layers": ["Sanitation"],
        "map": _sanitation_map,
        "geom_type": "POINT",
    },
    {
        "table": "amenities",
        "layers": ["Amenities"],
        "map": _amenities_map,
        "geom_type": "POINT",
    },
    {
        "table": "fh_location",
        "layers": ["FH_Location"],
        "map": _fh_location_map,
        "geom_type": "POINT",
    },
    {
        "table": "transformer",
        "layers": ["HT_POINT"],
        "map": _transformer_map,
        "geom_type": "POINT",
    },
    {
        "table": "kumbh_land",
        "layers": ["Kumbh_land_22_04_2026"],
        "map": _kumbh_land_map,
        "geom_type": "MULTIPOLYGON",
    },
    {
        "table": "core_parking",
        "layers": ["Parking"],
        "map": _core_parking_map,
        "geom_type": "POINT",  # Parking layer in the 2027 gdb is a point layer (see NOTE below)
    },
    {
        "table": "trench_line",
        "layers": ["Trench_Line"],
        "map": _trench_line_map,
        "geom_type": "MULTILINESTRING",
    },
]

# NOTE on core_parking: the live kumbh.core_parking table is MULTIPOLYGON (23
# rows today), but the 2027 gdb's "Parking" layer is POINT geometry (40 rows,
# all-null attributes per the sample dump) while "Parking_Line" is line
# geometry and "PERIPHERAL_PARKING" is point. None of the three is a polygon
# match for core_parking. Given the source Parking layer's attributes are
# entirely empty, this spec is disabled by default -- see SKIPPED_REPLACE
# below. core_parking is left unrefreshed this pass; Parking/Parking_Line/
# PERIPHERAL_PARKING are loaded as new tables instead (see NEW_TABLE_SPECS).
SKIPPED_REPLACE_TABLES = {"core_parking"}


def _hotel_map(p, source_layer):
    return {"name": clean(p.get("Name")), "category": clean(p.get("Category"))}


def _railway_line_map(p, source_layer):
    return {
        "osm_id": clean(p.get("osm_id")),
        "name": clean(p.get("name")),
        "type": clean(p.get("type")),
        "shape_length": p.get("Shape_Length"),
    }


def _railway_station_map(p, source_layer):
    return {
        "descriptio": clean(p.get("Descriptio")),
        "sector_name": clean(p.get("SectorName")),
        "latitude": p.get("Latitude"),
        "longitude": p.get("Longitude"),
        "remark": clean(p.get("Remark")),
        "type": clean(p.get("Type")),
    }


def _railway_station_area_map(p, source_layer):
    return {
        "name": clean(p.get("Name")),
        "shape_length": p.get("SHAPE_Length"),
        "shape_area": p.get("SHAPE_Area"),
    }


def _traffic_route_map(p, source_layer):
    return {
        "name": clean(p.get("Name")),
        "entry_exit": clean(p.get("Entry_Exit")),
        "plan": clean(p.get("Plan")),
        "direction": clean(p.get("Direction")),
        "weekend": p.get("Weekend"),
        "normal": p.get("Normal"),
        "peak_day": p.get("Peak_day"),
        "deh_dir": p.get("Deh_dir"),
        "naj_dir": p.get("Naj_dir"),
        "sah_dir": p.get("Sah_dir"),
        "meer_dir": p.get("Meer_dir"),
        "shape_length": p.get("Shape_Length"),
    }


def _tentcity_map(p, source_layer):
    return {
        "class": clean(p.get("Class")),
        "subclass": clean(p.get("Subclass")),
        "plot_no": clean(p.get("Plot_No")),
        "block": clean(p.get("Block")),
        "sector": clean(p.get("Sector")),
        "remark": clean(p.get("Remark")),
        "label": clean(p.get("Label")),
        "shape_length": p.get("SHAPE_Length"),
        "shape_area": p.get("SHAPE_Area"),
    }


def _ht_line_map(p, source_layer):
    return {"name": clean(p.get("Name")), "buffer_m": p.get("Buffer"), "shape_length": p.get("Shape_Length")}


def _ht_line_buffer_map(p, source_layer):
    return {
        "name": clean(p.get("Name")),
        "buffer_m": p.get("Buffer"),
        "buff_dist": p.get("BUFF_DIST"),
        "shape_length": p.get("Shape_Length"),
        "shape_area": p.get("Shape_Area"),
    }


def _water_line_map(p, source_layer):
    return {
        "sector": clean(p.get("Sector")),
        "water_line_type": clean(p.get("Water_Line")),
        "remark": clean(p.get("Remark")),
        "shape_length": p.get("SHAPE_Length"),
    }


def _water_point_map(p, source_layer):
    return {
        "type": clean(p.get("Type")),
        "dia": p.get("Dia"),
        "remarks": clean(p.get("Remarks")),
        "sector": clean(p.get("Sector")),
    }


def _landuse_map(p, source_layer):
    return {
        "objectid": p.get("OBJECTID"),
        "name": clean(p.get("Name")),
        "type": clean(p.get("Type")),
        "class": clean(p.get("Class")),
        "shape_length": p.get("Shape_Length"),
        "shape_area": p.get("Shape_Area"),
    }


def _dam_map(p, source_layer):
    return {
        "name": clean(p.get("Name")),
        "shape_length": p.get("SHAPE_Length"),
        "shape_area": p.get("SHAPE_Area"),
    }


def _uk_district_boundary_map(p, source_layer):
    return {
        "dtname": clean(p.get("dtname")),
        "stname": clean(p.get("stname")),
        "dtcode11": clean(p.get("dtcode11")),
        "shape_length": p.get("Shape_Length"),
        "shape_area": p.get("Shape_Area"),
    }


def _religious_place_map(p, source_layer):
    return {
        "descriptio": clean(p.get("Descriptio")),
        "sector_name": clean(p.get("SectorName")),
        "latitude": p.get("Latitude"),
        "longitude": p.get("Longitude"),
        "remark": clean(p.get("Remark")),
        "type": clean(p.get("Type")),
    }


def _landmark_map(p, source_layer):
    return {"name": clean(p.get("Name")), "type": clean(p.get("Type"))}


def _thematic_gate_map(p, source_layer):
    return {"remark": clean(p.get("Remark"))}


def _entry_exit_map(p, source_layer):
    return {"remark": clean(p.get("Remark")), "sector": clean(p.get("Sector"))}


def _junction_map(p, source_layer):
    return {"name": clean(p.get("Name")), "remark": clean(p.get("Remark"))}


def _direction_map(p, source_layer):
    return {
        "remark": clean(p.get("Remark")),
        "sector": clean(p.get("Sector")),
        "shape_length": p.get("SHAPE_Length"),
    }


def _footpath_map(p, source_layer):
    return {
        "name": clean(p.get("Name")),
        "remark": clean(p.get("Remark")),
        "shape_length": p.get("SHAPE_Length"),
    }


def _ropeway_map(p, source_layer):
    return {"name": clean(p.get("Name"))}


def _ropeway_area_map(p, source_layer):
    # Ropeway_Area itself has 0 features in this drop -- "Other" (Type=Ropeway
    # polygons) is the only source of actual ropeway-area data this pass.
    return {"name": clean(p.get("Name")), "shape_length": p.get("SHAPE_Length"), "shape_area": p.get("SHAPE_Area")}


def _bridge_point_map(p, source_layer):
    return {"name": clean(p.get("Name"))}


def _bus_terminal_point_map(p, source_layer):
    return {"name": clean(p.get("Name"))}


def _location_entry_map(p, source_layer):
    return {"name": clean(p.get("Name"))}


def _other_transport_map(p, source_layer):
    return {
        "name": clean(p.get("Name")),
        "shape_length": p.get("SHAPE_Length"),
        "shape_area": p.get("SHAPE_Area"),
    }


def _other_transport_point_map(p, source_layer):
    return {"name": clean(p.get("Name"))}


def _parking_map(p, source_layer):
    return {
        "name_of_parking": clean(p.get("Name_Of_Parking")),
        "sector": clean(p.get("Sector")),
        "ecs": p.get("ECS"),
        "subclass": clean(p.get("Subclass")),
    }


def _parking_line_map(p, source_layer):
    return {"sector_name": clean(p.get("Sector_Name")), "shape_length": p.get("SHAPE_Length")}


def _peripheral_parking_map(p, source_layer):
    return {"name": clean(p.get("Name")), "land_name": clean(p.get("Land_Name"))}


def _sector_point_map(p, source_layer):
    return {
        "class": clean(p.get("Class")),
        "plot_no": clean(p.get("Plot_No")),
        "block": clean(p.get("Block")),
        "sector": clean(p.get("Sector")),
        "subclass": clean(p.get("Subclass")),
        "remark": clean(p.get("Remark")),
        "label": clean(p.get("Label")),
        "remark_1": clean(p.get("Remark_1")),
        "area": p.get("Area"),
    }


def _tertiary_road_map(p, source_layer):
    # OSM-derived base street network (see PLAN-deferred-roads.md). Sector_Tertiary_Road
    # is a strict subset of Tertiary_Road (7,064 of its 7,068 osm_ids also appear in the
    # parent layer), so both load into one table and the subset is expressed as a flag
    # rather than a second table -- see dedupe_tertiary_road, which folds the duplicate
    # rows down after both layers have been read. Only 121 of 21k rows have a name --
    # fclass is the only reliably-populated descriptive column, so it drives both
    # styling and the low-zoom tile filter (see the tiles route).
    return {
        "osm_id": clean(p.get("osm_id")),
        "name": clean(p.get("name")),
        "fclass": clean(p.get("fclass")),
        "ref": clean(p.get("ref")),
        "oneway": clean(p.get("oneway")),
        "maxspeed": p.get("maxspeed"),
        "bridge": clean(p.get("bridge")),
        "tunnel": clean(p.get("tunnel")),
        "in_sector": source_layer == "Sector_Tertiary_Road",
        "shape_length": p.get("SHAPE_Length"),
    }


# (table, ddl_columns, geom_type, layers, map_fn)
NEW_TABLE_SPECS = [
    ("hotel", {"name": "text", "category": "text"}, "POINT", ["Hotel"], _hotel_map),
    (
        "railway_line",
        {"osm_id": "text", "name": "text", "type": "text", "shape_length": "double precision"},
        "MULTILINESTRING",
        ["Railway_Line"],
        _railway_line_map,
    ),
    (
        "railway_station",
        {
            "descriptio": "text",
            "sector_name": "text",
            "latitude": "double precision",
            "longitude": "double precision",
            "remark": "text",
            "type": "text",
        },
        "POINT",
        ["Railway_Stations"],
        _railway_station_map,
    ),
    (
        "railway_station_area",
        {"name": "text", "shape_length": "double precision", "shape_area": "double precision"},
        "MULTIPOLYGON",
        ["Railway_Station_Area"],
        _railway_station_area_map,
    ),
    (
        "traffic_route",
        {
            "name": "text",
            "entry_exit": "text",
            "plan": "text",
            "direction": "text",
            "weekend": "integer",
            "normal": "integer",
            "peak_day": "integer",
            "deh_dir": "integer",
            "naj_dir": "integer",
            "sah_dir": "integer",
            "meer_dir": "integer",
            "shape_length": "double precision",
        },
        "MULTILINESTRING",
        ["TRAFFIC_ROUTES"],
        _traffic_route_map,
    ),
    (
        "tentcity",
        {
            "class": "text",
            "subclass": "text",
            "plot_no": "text",
            "block": "text",
            "sector": "text",
            "remark": "text",
            "label": "text",
            "shape_length": "double precision",
            "shape_area": "double precision",
        },
        "MULTIPOLYGON",
        ["Tentcity"],
        _tentcity_map,
    ),
    (
        "ht_line",
        {"name": "text", "buffer_m": "double precision", "shape_length": "double precision"},
        "MULTILINESTRING",
        ["HT_LINE"],
        _ht_line_map,
    ),
    (
        "ht_line_buffer",
        {
            "name": "text",
            "buffer_m": "double precision",
            "buff_dist": "double precision",
            "shape_length": "double precision",
            "shape_area": "double precision",
        },
        "MULTIPOLYGON",
        ["HT_LINE_Buffer"],
        _ht_line_buffer_map,
    ),
    (
        "water_line",
        {"sector": "text", "water_line_type": "text", "remark": "text", "shape_length": "double precision"},
        "MULTILINESTRING",
        ["Water_Line"],
        _water_line_map,
    ),
    (
        "water_point",
        {"type": "text", "dia": "double precision", "remarks": "text", "sector": "text"},
        "POINT",
        ["Water_Point"],
        _water_point_map,
    ),
    (
        "landuse",
        {
            "objectid": "integer",
            "name": "text",
            "type": "text",
            "class": "text",
            "shape_length": "double precision",
            "shape_area": "double precision",
        },
        "MULTIPOLYGON",
        ["landuse"],
        _landuse_map,
    ),
    (
        "dam",
        {"name": "text", "shape_length": "double precision", "shape_area": "double precision"},
        "MULTIPOLYGON",
        ["Dam"],
        _dam_map,
    ),
    (
        "uk_district_boundary",
        {
            "dtname": "text",
            "stname": "text",
            "dtcode11": "text",
            "shape_length": "double precision",
            "shape_area": "double precision",
        },
        "MULTIPOLYGON",
        ["UK_District_Boundary"],
        _uk_district_boundary_map,
    ),
    (
        "religious_place",
        {
            "descriptio": "text",
            "sector_name": "text",
            "latitude": "double precision",
            "longitude": "double precision",
            "remark": "text",
            "type": "text",
        },
        "POINT",
        ["Religious_Place_Haridwar_Mahakumbh"],
        _religious_place_map,
    ),
    ("landmark", {"name": "text", "type": "text"}, "POINT", ["Landmark"], _landmark_map),
    ("thematic_gate", {"remark": "text"}, "POINT", ["Thematic_Gate"], _thematic_gate_map),
    (
        "entry_exit",
        {"remark": "text", "sector": "text"},
        "POINT",
        ["Entry_Exit"],
        _entry_exit_map,
    ),
    (
        "entry_exit_line",
        {"remark": "text", "sector": "text"},
        "LineString",
        ["Entry_Exist_l"],
        _entry_exit_map,
    ),
    ("junction", {"name": "text", "remark": "text"}, "POINT", ["Junction"], _junction_map),
    (
        "direction_line",
        {"remark": "text", "sector": "text", "shape_length": "double precision"},
        "MULTILINESTRING",
        ["DIRECTION"],
        _direction_map,
    ),
    (
        "footpath",
        {"name": "text", "remark": "text", "shape_length": "double precision"},
        "MULTILINESTRING",
        ["Footpath"],
        _footpath_map,
    ),
    ("ropeway", {"name": "text"}, "POINT", ["Ropeway"], _ropeway_map),
    (
        "ropeway_area",
        {"name": "text", "shape_length": "double precision", "shape_area": "double precision"},
        "MULTIPOLYGON",
        ["Other"],  # "Other" holds the only actual ropeway-area polygons in this drop; see note above
        _ropeway_area_map,
    ),
    ("bridge_point", {"name": "text"}, "POINT", ["Bridge_Point"], _bridge_point_map),
    (
        "bus_terminal_point",
        {"name": "text"},
        "POINT",
        ["Bus_Terminal_Point"],
        _bus_terminal_point_map,
    ),
    ("location_entry", {"name": "text"}, "POINT", ["Location_Entry"], _location_entry_map),
    (
        "other_transport",
        {"name": "text", "shape_length": "double precision", "shape_area": "double precision"},
        "MULTIPOLYGON",
        ["Others_Transport"],
        _other_transport_map,
    ),
    (
        "other_transport_point",
        {"name": "text"},
        "POINT",
        ["Others_Point"],
        _other_transport_point_map,
    ),
    (
        "parking",
        {"name_of_parking": "text", "sector": "text", "ecs": "integer", "subclass": "text"},
        "POINT",
        ["Parking"],
        _parking_map,
    ),
    (
        "parking_line",
        {"sector_name": "text", "shape_length": "double precision"},
        "MULTILINESTRING",
        ["Parking_Line"],
        _parking_line_map,
    ),
    (
        "peripheral_parking",
        {"name": "text", "land_name": "text"},
        "POINT",
        ["PERIPHERAL_PARKING"],
        _peripheral_parking_map,
    ),
    (
        "sector_point",
        {
            "class": "text",
            "plot_no": "text",
            "block": "text",
            "sector": "text",
            "subclass": "text",
            "remark": "text",
            "label": "text",
            "remark_1": "text",
            "area": "double precision",
        },
        "POINT",
        ["SECTOR_POINT"],
        _sector_point_map,
    ),
    (
        "tertiary_road",
        {
            "osm_id": "text",
            "name": "text",
            "fclass": "text",
            "ref": "text",
            "oneway": "text",
            "maxspeed": "integer",
            "bridge": "text",
            "tunnel": "text",
            "in_sector": "boolean",
            "shape_length": "double precision",
        },
        "MULTILINESTRING",
        # Order matters: Tertiary_Road (the 2D parent, 21,280 rows) must load first so
        # dedupe_tertiary_road below keeps its geometry for the 7,064 osm_ids the two
        # layers share, and only carries in_sector=true across from the subset layer.
        ["Tertiary_Road", "Sector_Tertiary_Road"],
        _tertiary_road_map,
    ),
]


def backfill_sector_no(conn, table):
    """Fills any remaining NULL sector_no on `table` (rows whose Sector text
    had no parseable trailing '-NN', e.g. 'PARIPHERAL') via a spatial join
    against the freshly loaded kumbh.sector_boundary -- same ST_Intersects
    pattern already used for dustbins/transformer/sanitation in stats/route.ts,
    applied here at load time instead of query time since sector_no is a real
    indexed column on this table."""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE kumbh.{table} t
            SET sector_no = b.sector_no
            FROM kumbh.sector_boundary b
            WHERE t.sector_no IS NULL AND ST_Intersects(b.geom, t.geom)
            """
        )
        n = cur.rowcount
        conn.commit()
    print(f"  backfilled sector_no on {n} rows via spatial join against sector_boundary")


def dedupe_tertiary_road(conn):
    """Sector_Tertiary_Road repeats rows already present in Tertiary_Road (see the
    NEW_TABLE_SPECS entry's comment) -- keep the parent-layer row's geometry and carry
    the subset's in_sector flag across onto it, then drop the duplicate. Also adds the
    two indexes load_new_table's generic CREATE INDEX block doesn't know to add for this
    table: fclass (read on every low-zoom tile request, see the tiles route) and a
    partial index on in_sector for the "sector streets only" filter."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE kumbh.tertiary_road t SET in_sector = true "
            "WHERE t.in_sector = false AND EXISTS ("
            "  SELECT 1 FROM kumbh.tertiary_road d "
            "  WHERE d.osm_id = t.osm_id AND d.in_sector = true)"
        )
        cur.execute(
            "DELETE FROM kumbh.tertiary_road a USING kumbh.tertiary_road b "
            "WHERE a.osm_id = b.osm_id AND a.id > b.id"
        )
        n = cur.rowcount
        cur.execute(
            "CREATE INDEX IF NOT EXISTS tertiary_road_fclass_idx ON kumbh.tertiary_road (fclass)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS tertiary_road_in_sector_idx "
            "ON kumbh.tertiary_road (in_sector) WHERE in_sector"
        )
        conn.commit()
    print(f"  deduped {n} rows shared with Sector_Tertiary_Road (kept in_sector flag)")


def get_conn():
    env_path = REPO_ROOT / ".env.local"
    env_text = env_path.read_text()
    m = re.search(r"POSTGRES_URL=(.+)", env_text)
    if not m:
        print("POSTGRES_URL not found in .env.local", file=sys.stderr)
        sys.exit(1)
    url = m.group(1).strip().strip('"')
    return psycopg2.connect(url)


def backup_table(cur, table):
    backup_name = f"{table}_backup_{BACKUP_SUFFIX}"
    cur.execute(f"DROP TABLE IF EXISTS kumbh.{backup_name}")
    cur.execute(f"CREATE TABLE kumbh.{backup_name} AS SELECT * FROM kumbh.{table}")
    cur.execute(f"SELECT count(*) FROM kumbh.{backup_name}")
    n = cur.fetchone()[0]
    print(f"  backed up {n} rows -> kumbh.{backup_name}")


def load_replace_table(conn, spec, dry_run):
    table = spec["table"]
    print(f"\n=== {table} (replace) ===")
    if table in SKIPPED_REPLACE_TABLES:
        print(f"  SKIPPED (see SKIPPED_REPLACE_TABLES note in script)")
        return 0

    features = []
    for layer in spec["layers"]:
        with fiona.open(GDB_PATH, layer=layer) as src:
            for f in src:
                if f["geometry"] is None:
                    continue
                geom = reproject(shape(f["geometry"]))
                row = spec["map"](dict(f["properties"]), layer)
                features.append((row, geom))
    print(f"  read {len(features)} features from {spec['layers']}")

    if dry_run:
        return len(features)

    with conn.cursor() as cur:
        backup_table(cur, table)

        extra_cols = spec.get("extra_columns", {})
        for col, coltype in extra_cols.items():
            cur.execute(
                f"ALTER TABLE kumbh.{table} ADD COLUMN IF NOT EXISTS {col} {coltype}"
            )

        cur.execute(f"TRUNCATE kumbh.{table} RESTART IDENTITY")

        if not features:
            conn.commit()
            return 0

        cols = list(features[0][0].keys())
        col_list = ", ".join(cols)
        placeholders = ", ".join(["%s"] * len(cols))
        sql = (
            f"INSERT INTO kumbh.{table} ({col_list}, geom) "
            f"VALUES ({placeholders}, ST_SetSRID(ST_GeomFromText(%s), {TARGET_SRID}))"
        )
        batch = [tuple(row.get(c) for c in cols) + (geom.wkt,) for row, geom in features]
        psycopg2.extras.execute_batch(cur, sql, batch, page_size=500)
        conn.commit()

    print(f"  inserted {len(features)} rows into kumbh.{table}")
    return len(features)


def ddl_type_for(colname, coltype):
    return f"{colname} {coltype}"


def _open_layer(layer):
    """Entry_Exist_l lives in a standalone shapefile next to the gdb, not as
    a gdb layer -- every other name is read from the gdb itself."""
    if layer == "Entry_Exist_l":
        return fiona.open(ENTRY_EXIST_SHP)
    return fiona.open(GDB_PATH, layer=layer)


def load_new_table(conn, table, columns, geom_type, layers, map_fn, dry_run):
    print(f"\n=== {table} (new) ===")

    features = []
    for layer in layers:
        with _open_layer(layer) as src:
            for f in src:
                if f["geometry"] is None:
                    continue
                geom = force_2d(reproject(shape(f["geometry"])))
                row = map_fn(dict(f["properties"]), layer)
                features.append((row, geom))
    print(f"  read {len(features)} features from {layers}")

    if not features:
        print("  0 features -- table not created")
        return 0

    if dry_run:
        return len(features)

    with conn.cursor() as cur:
        col_ddl = ",\n            ".join(ddl_type_for(c, t) for c, t in columns.items())
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS kumbh.{table} (
                id serial PRIMARY KEY,
                {col_ddl},
                geom geometry({geom_type}, {TARGET_SRID})
            )
            """
        )
        cur.execute(
            f"CREATE INDEX IF NOT EXISTS {table}_geom_idx ON kumbh.{table} USING GIST (geom)"
        )
        if "sector" in columns:
            cur.execute(
                f"CREATE INDEX IF NOT EXISTS {table}_sector_idx ON kumbh.{table} USING btree (sector)"
            )
        cur.execute(f"TRUNCATE kumbh.{table} RESTART IDENTITY")

        cols = list(columns.keys())
        col_list = ", ".join(cols)
        placeholders = ", ".join(["%s"] * len(cols))
        sql = (
            f"INSERT INTO kumbh.{table} ({col_list}, geom) "
            f"VALUES ({placeholders}, ST_SetSRID(ST_GeomFromText(%s), {TARGET_SRID}))"
        )
        batch = [tuple(row.get(c) for c in cols) + (geom.wkt,) for row, geom in features]
        psycopg2.extras.execute_batch(cur, sql, batch, page_size=500)
        conn.commit()

    print(f"  inserted {len(features)} rows into kumbh.{table}")
    return len(features)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Read + report counts, write nothing")
    parser.add_argument("--only", type=str, default=None, help="Comma-separated table names to run")
    args = parser.parse_args()

    only = set(args.only.split(",")) if args.only else None

    if not GDB_PATH.exists():
        print(f"gdb not found at {GDB_PATH}", file=sys.stderr)
        sys.exit(1)

    conn = get_conn()
    results = {}

    # sector_boundary must load first: sector_plan/road's sector_no backfill
    # depends on spatially joining against it.
    ordered_specs = sorted(REPLACE_SPECS, key=lambda s: 0 if s["table"] == "sector_boundary" else 1)

    try:
        for spec in ordered_specs:
            if only and spec["table"] not in only:
                continue
            results[spec["table"]] = load_replace_table(conn, spec, args.dry_run)
            if not args.dry_run and spec["table"] in ("sector_plan", "road"):
                backfill_sector_no(conn, spec["table"])

        for table, columns, geom_type, layers, map_fn in NEW_TABLE_SPECS:
            if only and table not in only:
                continue
            results[table] = load_new_table(conn, table, columns, geom_type, layers, map_fn, args.dry_run)
            if not args.dry_run and table == "tertiary_road":
                dedupe_tertiary_road(conn)
    finally:
        conn.close()

    print("\n" + "=" * 50)
    print("SUMMARY" + (" (dry run -- nothing written)" if args.dry_run else ""))
    print("=" * 50)
    for table, count in results.items():
        print(f"  {table:30s} {count:>6} rows")


if __name__ == "__main__":
    main()
