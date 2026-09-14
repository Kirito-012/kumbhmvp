#!/usr/bin/env python3
"""Loads the Kumbh_Mela_2027_V1_07_07 geodatabase (+ Entry_Exist_l.shp) into the
`kumbh` Postgres/PostGIS schema.

Usage:
    python scripts/load_kumbh_2027.py [--dry-run] [--only table1,table2] [--source-root PATH]

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

Source of truth / exceptions (see PLAN-evacuation.md §1-§3): the 2027 geodatabase
(Kumbh_Mela_2027_V1_07_07) is authoritative for everything. Three tables are
sourced instead (or also) from the older 25 Aug 2026 shapefile drop
(Kumbh_Mela_Shape/25_08_2026/), because the 2027 gdb dropped or never had this
data: `emergency_exit` (SHP_TABLE_SPECS), `hfl_area`/`hfl_line` (flood risk,
SHP_TABLE_SPECS), and 21 hospital rows appended to `public_service_facilities`
(supplement_public_service_facilities). Every row sourced that way carries
`source = 'shp_2026_08_25'` so the app can flag it as coming from older data;
everything else carries `source = 'gdb_2027'` where the table has that column.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import re
import sys
from pathlib import Path

import fiona
import psycopg2
import psycopg2.extras
from pyproj import Transformer
from shapely.geometry import MultiLineString, MultiPolygon, shape, mapping
from shapely.ops import transform as shapely_transform

REPO_ROOT = Path(__file__).resolve().parent.parent

# Default layout: the source data drop lives in "Kumbh Data/" at the repo root
# (not committed -- see .gitignore). Older checkouts had the gdb directly at
# the repo root instead; if "Kumbh Data" isn't present, resolve_source_root()
# below falls back to that legacy layout so this script keeps working either
# way. --source-root overrides both.
DEFAULT_SOURCE_ROOT = REPO_ROOT / "Kumbh Data"
LEGACY_SOURCE_ROOT = REPO_ROOT

# Mutable module state -- resolved once in main() (or by callers of
# resolve_source_root() in tests) before any loading happens. Every loader
# function reads these at call time, never a value captured at import time.
SOURCE_ROOT = DEFAULT_SOURCE_ROOT
GDB_PATH = SOURCE_ROOT / "Kumbh_Mela_2027_V1_07_07" / "Kumbh_Mela_2027_V1_07_07.gdb"
ENTRY_EXIST_SHP = SOURCE_ROOT / "Kumbh_Mela_2027_V1_07_07" / "Entry_Exist_l.shp"
SHP_2026_08_25_DIR = SOURCE_ROOT / "Kumbh_Mela_Shape" / "25_08_2026"


def resolve_source_root(explicit: str | None) -> Path:
    """--source-root wins outright. Otherwise prefer DEFAULT_SOURCE_ROOT ("Kumbh Data/")
    if its gdb is present, then fall back to the legacy repo-root layout -- see the
    module docstring's comment on DEFAULT_SOURCE_ROOT/LEGACY_SOURCE_ROOT above."""
    if explicit:
        return Path(explicit).expanduser().resolve()
    for candidate in (DEFAULT_SOURCE_ROOT, LEGACY_SOURCE_ROOT):
        if (candidate / "Kumbh_Mela_2027_V1_07_07" / "Kumbh_Mela_2027_V1_07_07.gdb").exists():
            return candidate
    return DEFAULT_SOURCE_ROOT


def set_source_root(root: Path) -> None:
    """Repoints every path constant at `root` -- called once from main() after
    argparse resolves --source-root, and by anything else that needs a non-default
    root (e.g. a future test). Must run before any load_*/GDB_PATH.exists() call."""
    global SOURCE_ROOT, GDB_PATH, ENTRY_EXIST_SHP, SHP_2026_08_25_DIR
    SOURCE_ROOT = root
    GDB_PATH = SOURCE_ROOT / "Kumbh_Mela_2027_V1_07_07" / "Kumbh_Mela_2027_V1_07_07.gdb"
    ENTRY_EXIST_SHP = SOURCE_ROOT / "Kumbh_Mela_2027_V1_07_07" / "Entry_Exist_l.shp"
    SHP_2026_08_25_DIR = SOURCE_ROOT / "Kumbh_Mela_Shape" / "25_08_2026"


SOURCE_SRID = 32644
TARGET_SRID = 4326
BACKUP_SUFFIX = datetime.date.today().strftime("%Y%m%d")

# Tags for the `source` column added to tables that mix 2027-gdb rows with
# 25-Aug-shapefile rows (or are sourced from the shapefile entirely) -- see the
# module docstring. Every REPLACE_SPECS/NEW_TABLE_SPECS row from the gdb gets
# SOURCE_TAG_2027 where its table has a `source` column; every SHP_TABLE_SPECS
# row, and the hospitals supplement_public_service_facilities appends, get
# SOURCE_TAG_SHP.
SOURCE_TAG_2027 = "gdb_2027"
SOURCE_TAG_SHP = "shp_2026_08_25"

_transformer = Transformer.from_crs(f"EPSG:{SOURCE_SRID}", f"EPSG:{TARGET_SRID}", always_xy=True)


def reproject(geom):
    """Reprojects a shapely geometry from EPSG:32644 to EPSG:4326."""
    return shapely_transform(lambda x, y, z=None: _transformer.transform(x, y), geom)


def to_multi(geom):
    """Promotes a bare Polygon/LineString to Multi* -- every `kumbh.*` geom column is
    declared Multi (see load_new_table/load_shp_new_table's CREATE TABLE), but the 25 Aug
    shapefile drop stores some of these layers (Sector_Plan_Road, Disastar_Management,
    HFL_Line, Public_Service_Facilities) as plain Polygon/LineString rather than the
    Multi variant the 2027 gdb happens to use for the same real-world layers. Inserting a
    bare WKT into a Multi-typed column errors ("Geometry type ... does not match column
    type"), so every SHP_TABLE_SPECS/supplement geometry is passed through this first.
    A no-op on anything already Multi (or any other geometry type)."""
    if geom.geom_type == "Polygon":
        return MultiPolygon([geom])
    if geom.geom_type == "LineString":
        return MultiLineString([geom])
    return geom


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


def geom_content_hash(geom_4326):
    """MD5 of a geometry's vertex list at mm precision, post-reprojection to EPSG:4326
    -- i.e. computed on exactly the coordinates load_replace_table/load_new_table already
    have in hand after `reproject()`. Used to key exclusion sets (see
    ROAD_SECONDARY_DUPLICATE_HASHES) on geometry *content* rather than source row index,
    so a re-exported/reordered gdb doesn't silently invalidate a human-reviewed drop list."""
    coords = []

    def collect(g):
        if hasattr(g, "geoms"):
            for part in g.geoms:
                collect(part)
        else:
            coords.extend(g.coords)

    collect(geom_4326)
    rounded = tuple((round(x, 7), round(y, 7)) for x, y in coords)
    return hashlib.md5(repr(rounded).encode()).hexdigest()


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
    # in classColors.ts exactly) plus Sector_Name/Kumbh_Land. Road (55 rows) and
    # Secondary_Road (171 rows) carry only a bare Name + length and were
    # wrongly used as the primary source in the first load pass -- kept here
    # only as a supplementary named-highway layer, tagged road_class so they
    # stay distinguishable from ROAD_IN_M's project road network. Road_Secondary
    # (109 rows, 97 dropped as duplicates -- see ROAD_SECONDARY_DUPLICATE_HASHES)
    # is a fourth, unrelated source layer despite the near-identical name; it
    # falls into the road_class="Secondary" branch below same as Secondary_Road.
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
    # subclass/services/category/bed are always null straight from the 2027 gdb -- neither
    # Public_Service_Facilities nor FSTP carries those columns there at all. The 25 Aug
    # shapefile drop does have them for the same 57 facilities (plus 21 more,
    # Hospital/Health Camping rows the gdb doesn't carry); see
    # supplement_public_service_facilities, which fills them in and appends those extra
    # rows as a post-load step, keyed by matching this table's rows to the shapefile's by
    # centroid. `source` distinguishes a plain gdb row from a supplement-appended one.
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
            "source": SOURCE_TAG_2027,
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
        "source": SOURCE_TAG_2027,
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


# ---------------------------------------------------------------------------
# 25 Aug 2026 shapefile exceptions (SHP_TABLE_SPECS below) -- see the module
# docstring and PLAN-evacuation.md §2.3. Unlike REPLACE_SPECS/NEW_TABLE_SPECS,
# these read a single standalone shapefile (not a gdb layer) via
# load_shp_new_table, and every mapped row carries source=SOURCE_TAG_SHP.
# ---------------------------------------------------------------------------


def _emergency_exit_map(p, source_layer):
    # Sector_Plan_Road's Type='Emergency Exit' rows (see SHP_TABLE_SPECS' filter) -- the
    # 2027 gdb relabels 23 of these 24 paths as plain 'Proposed Road' in ROAD_IN_M (their
    # vertices coincide almost exactly), so this is the only place emergency exits still
    # exist as their own thing. sector_no is parsed the same way as every other free-text
    # sector name; the 1 row this can't parse gets backfilled spatially (see main()).
    sector_name = clean(p.get("Sector_Nam"))
    return {
        "road_name": clean(p.get("Road_Name")),
        "row_width_m": p.get("ROW"),
        "sector_name": sector_name,
        "sector_no": _sector_no_from_name(sector_name),
        "source": SOURCE_TAG_SHP,
    }


def _hfl_area_map(p, source_layer):
    # Disastar_Management.shp -- 19 "HFL Area" polygons (area below the High Flood Level),
    # one per sector. Remark carries the sector name (e.g. "KANKHAL-10"), which matches a
    # 2027 sector_boundary.name exactly for every row, so sector_no parses the same way.
    name = clean(p.get("Remark"))
    return {
        "type": clean(p.get("Type")),
        "name": name,
        "sector_no": _sector_no_from_name(name),
        "area_m2": p.get("SHAPE_Area"),
        "source": SOURCE_TAG_SHP,
    }


_HFL_LINE_NAME_RE = re.compile(r"(\d+)\s*Y\s*(LB|RB)?", re.IGNORECASE)


def _parse_hfl_line_name(name):
    """'25 Y RB' -> (25, 'RB'); '100 Y LB' -> (100, 'LB'); '25 Y' -> (25, None)."""
    if not name:
        return None, None
    m = _HFL_LINE_NAME_RE.search(name)
    if not m:
        return None, None
    return int(m.group(1)), (m.group(2).upper() if m.group(2) else None)


def _hfl_line_map(p, source_layer):
    # HFL_Line.shp -- 17 flood-extent lines for the 25/50/100-year return period, on the
    # left ("LB") and right ("RB") bank. return_period_years/bank are parsed out of Name
    # (e.g. "25 Y RB") rather than stored as their own source columns.
    name = clean(p.get("Name"))
    years, bank = _parse_hfl_line_name(name)
    return {
        "name": name,
        "return_period_years": years,
        "bank": bank,
        "source": SOURCE_TAG_SHP,
    }


# (table, ddl_columns, geom_type, shp_filename, map_fn, feature_filter)
# shp_filename is resolved against SHP_2026_08_25_DIR at call time (see load_shp_new_table),
# not baked in here, since SOURCE_ROOT/SHP_2026_08_25_DIR are only known once main() has
# parsed --source-root.
SHP_TABLE_SPECS = [
    (
        "emergency_exit",
        {
            "road_name": "text",
            "row_width_m": "double precision",
            "sector_name": "text",
            "sector_no": "integer",
            "source": "text",
        },
        "MULTILINESTRING",
        "Sector_Plan_Road.shp",
        _emergency_exit_map,
        lambda p: clean(p.get("Type")) == "Emergency Exit",
    ),
    (
        "hfl_area",
        {
            "type": "text",
            "name": "text",
            "sector_no": "integer",
            "area_m2": "double precision",
            "source": "text",
        },
        "MULTIPOLYGON",
        "Disastar_Management.shp",
        _hfl_area_map,
        None,
    ),
    (
        "hfl_line",
        {"name": "text", "return_period_years": "integer", "bank": "text", "source": "text"},
        "MULTILINESTRING",
        "HFL_Line.shp",
        _hfl_line_map,
        None,
    ),
]


# `Road_Secondary` (109 features, see Pending.md / PLAN-deferred-roads.md Phase 4) is
# 85% re-digitisation of geometry already loaded from other layers -- 93 of its 109
# rows are >=90% length-covered (15m buffer, EPSG:32644 planar) by the union of nearby
# kumbh.traffic_route/kumbh.road geometry, plus 4 more (idx 0/2/25/42, a set of loosely-
# digitised "Entry"/"Exit"/"Peak day entry" routes at 72-89% coverage at 15m but >=92%
# at 30m) confirmed as duplicates by a human reviewer rather than auto-classified. The
# 12 survivors are 11 genuinely new unnamed segments plus one named road ("Haridwar Main
# Road", idx 88 -- 100% covered by a traffic_route but only 55% by kumbh.road, i.e. a
# route running along an existing road, not a re-digitisation of the road itself).
#
# Keyed on geom_content_hash() (post-reprojection, mm precision) rather than source row
# index, so a re-exported/reordered gdb doesn't silently invalidate this human-reviewed
# list. If the gdb's Road_Secondary geometry ever changes, every hash here stops
# matching and load_replace_table raises (see its "skip_hashes declared ... but none
# matched" check) instead of silently re-admitting the 97 duplicates -- regenerate this
# set in that case rather than removing the check.
ROAD_SECONDARY_DUPLICATE_HASHES = frozenset({
    "bd5489cdf75ece83b58e8fb39567264d",
    "e0cae774bbfbb97d8f66ea82a1ea332c",
    "0e49d24e200ba62c9383692254251dd5",
    "8ec2d25a95d2928c3458669f5919c96a",
    "9dcf6c9f1c6b4d8f669be3d14c149ca3",
    "fccd7ea68cf75bf381f7bc9d71bf7fd0",
    "0bb679a4b9a85454b716ac679388ecf1",
    "51598d9232d83a3ece0ac46d712a028b",
    "c566f5a03998155cb9d44c6433e1b476",
    "f2744fb98449419bc2e91a222436d914",
    "4c8ab04d6f1ad077d22b1b91c1824d0f",
    "d72924014a447c80e824dfb313507481",
    "4dcf53e26927c758c72407eeb8c663fa",
    "212f1ede4a8d04ee46c9e068ee478549",
    "d5619b865dc4161e4aa3b35dbe7a7d19",
    "20b31e80ab08d12ce60dbdde113adb0f",
    "d00331796eb691eb4c6f6152806b0eb0",
    "c76b994da732bdacce7e3503b504594c",
    "6bbb292f2f013cd21ef8c8ebcf979b7e",
    "2294a01b6fd081d12209b31088148823",
    "8482c6dc119a81ad017bce5e4e76e08d",
    "f68cefd2571502ce7662a449a7070bde",
    "a0229594dff7d2675dc9c5e6b1518c51",
    "2eb1e02313e4223100b93258ec79a5b0",
    "c866b5e72e424939f6554db79ece5623",
    "086134f2b8df913b30cf55c969fec422",
    "9491122523e1ab605c13e36c4dffef9a",
    "a55a948caaf5460eff0009bcc3222850",
    "b1adac0d4b18dfae5a390b480064b659",
    "c74fe286bbb3b614d965f3b785ad6bdc",
    "4a3bfab2c4859b2825317f2618047e39",
    "4a7c01fe049bbaa407340447c628040c",
    "8863fe1db65cd4f12e335c59890ecc5c",
    "6f9cd94c75e84136c87747f24a70f4af",
    "c6e5e7dc67a57c0df56ac5da2b83043e",
    "609d06be14817264d624d19203b5a4c3",
    "57c51181bd92642ea7721f4eaeb8c1b8",
    "4f977fdd581ac9611e6e26360eae5d86",
    "cb0580d52eb3b6b2c2acbc2f0e26ef03",
    "1b7b036dceb2c402c67747f28576ae94",
    "a079ca068c4845e980eb54727ea904e2",
    "d1bca619f4ef85ee92a5cb7b29f1f532",
    "6498bd5dd5e878333079f0dd08b2af6b",
    "09df397d3f07c1ec5ba2d5a68a147a60",
    "27aa1cad6cfb75f3bfb42421389ac32e",
    "d16887bd71804055e63c3b95dc1b9088",
    "dfd1110050ec3cea44404d5225cdc0d7",
    "b94d390a17021c5e8c5cbc837e01938c",
    "0fa962f3022ce3891da1306e03cb37b1",
    "6510f3a07718881bf41261fc3fa3f9b5",
    "77d7ce466fdd16f87e4a6328fe8f1e81",
    "5dfe180ba088058b826a07eb61f794a4",
    "ff742cdcd3cac68a5407f34d0103b09c",
    "686c449a8332d40eb6564a4fea8df179",
    "5ab796091c8c59dd3f388c034e061aa4",
    "5d6dd9a95f1effe0c4f36ca49f187c10",
    "488cce72bc403eb26138eb9345676a7e",
    "24ae67dbf287cb75540500a0d413c98a",
    "3c0b3b171109459fa2ef6490246f52c7",
    "b8ca83e982d3d3eefadd3ed05319f7c5",
    "7a5d3f424e4e82b866cc9b96cae059a6",
    "9e7abf5e10cc53362625d6b5fa047311",
    "19a719ba35b8cd2e8d460e5e8784d74d",
    "fb8bf6b4c0819de9c816fcf42c90662f",
    "bc33d1563281e70f3510e16c644a1f70",
    "cc21429264e8f99648c19f8ed47caf75",
    "067d1600bd7b0b24f655e2bcd096eaf0",
    "33a83f6c3ea9064444d5ceaa78044487",
    "ccc4e28be991566372352ea762fe55c2",
    "316849ac8eb07206aa51f2e64a4bed35",
    "ae97692c75acbca45261412991e4239e",
    "e55a7e64fbaf6b30075aedb70de2898b",
    "9a629e9120a827195985f24d43fecef5",
    "67a50d7f1c7c5caa94204445fa0e30db",
    "882b0b032b50524ddc84993ebedbef14",
    "59a897c9311608803556d2ec6d03c2a5",
    "f3ea3bad390e9aa14500bf7c8aa17a22",
    "ed86d7d8885b9f30de4cebc3f98aa74c",
    "97ded2176e6a73e21e4c91d41497e524",
    "80f7083c0674159cbfc10e1471f60f0b",
    "4fc7c55db66b2a52368b89abc5a3807a",
    "aa85278eb0631e4ad7720ae01d46ff09",
    "da0422f989ed94cc6625683563cafb6e",
    "1434be90bc7385017e7bea965528e90b",
    "89270b1d2c00155b020c0b93eb6b61d0",
    "572d0417c3be58f5e57fe1498ef0e4fb",
    "1977637e3537c0b587fe573978a326b5",
    "6ca002cc16cca27b376d67cd8e2fb605",
    "8e7eaaea97303bc79db9225ade16eb95",
    "5e6c687f1f6c777bb77a0d5a9e374022",
    "aca0d636ce35bf7d88531814ff182660",
    "79daf1cd00e0bc797c725f3348541c70",
    "3cd4d69e8c968e77e2e6c3666e59adcb",
    "894a8c36f1c381ca41ffc1f625854125",
    "370f516ab4a4d09d87a9f57f09efd5af",
    "4080dba78e4e15204e6a8c83757b4bb9",
    "72e43060d4259f49431e0c6449f35c8e",
})


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
        # The 2027 gdb's SECTOR_BOUNDARY_UPDATED has no Zone column -- backfill_sector_zone
        # (below) fills this in by name from the 25 Aug shapefile's own SECTOR_BOUNDARY_UPDATED,
        # which does carry one (all 32 sector names match exactly). See PLAN-evacuation.md §2.4.
        "extra_columns": {"zone": "text"},
    },
    {
        "table": "road",
        "layers": ["ROAD_IN_M", "Road", "Secondary_Road", "Road_Secondary"],
        "map": _road_map,
        "geom_type": "MULTILINESTRING",
        "extra_columns": {"road_class": "text"},
        # See ROAD_SECONDARY_DUPLICATE_HASHES above -- 97 of Road_Secondary's 109 rows
        # are re-digitisations of geometry already loaded from other layers.
        "skip_hashes": {"Road_Secondary": ROAD_SECONDARY_DUPLICATE_HASHES},
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
        # See supplement_public_service_facilities below -- a full reload of this table
        # truncates it back to plain gdb rows (source='gdb_2027', subclass/services/
        # category/bed all null), so main() re-runs the supplement immediately after.
        "extra_columns": {"source": "text"},
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

    skip_hashes = spec.get("skip_hashes", {})
    features = []
    total_skipped = 0
    for layer in spec["layers"]:
        layer_skip = skip_hashes.get(layer)
        layer_skipped = 0
        with fiona.open(GDB_PATH, layer=layer) as src:
            for f in src:
                if f["geometry"] is None:
                    continue
                geom = reproject(shape(f["geometry"]))
                if layer_skip and geom_content_hash(geom) in layer_skip:
                    layer_skipped += 1
                    continue
                row = spec["map"](dict(f["properties"]), layer)
                features.append((row, geom))
        # Loud failure over silent staleness: if a layer declares skip_hashes but none of
        # its features matched, either the gdb's geometry changed since the hashes were
        # generated (drop list stale) or the layer is empty -- either way don't ship
        # duplicates back into kumbh.road under a mistaken belief the drop list still applies.
        if layer_skip is not None and layer_skipped == 0:
            raise RuntimeError(
                f"skip_hashes declared for layer {layer!r} but none matched -- "
                f"the drop list is stale (geometry changed) or the layer is empty; "
                f"regenerate ROAD_SECONDARY_DUPLICATE_HASHES before proceeding"
            )
        total_skipped += layer_skipped
    print(f"  read {len(features)} features from {spec['layers']}" + (f" ({total_skipped} skipped as duplicates)" if total_skipped else ""))

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


def load_shp_new_table(conn, table, columns, geom_type, shp_filename, map_fn, dry_run, feature_filter=None):
    """Like load_new_table, but reads one standalone shapefile from SHP_2026_08_25_DIR
    (the 25 Aug 2026 drop, kept only for the handful of layers the 2027 gdb dropped or
    never had -- see the module docstring and SHP_TABLE_SPECS above) instead of a gdb
    layer, and optionally filters raw features by their properties before mapping (e.g.
    Sector_Plan_Road.shp's Type='Emergency Exit' rows only). Source geometry here is
    often plain Polygon/LineString rather than the Multi* variant the target column is
    declared as, so every geometry is passed through to_multi()."""
    shp_path = SHP_2026_08_25_DIR / shp_filename
    print(f"\n=== {table} (new, from {shp_filename}) ===")
    if not shp_path.exists():
        print(f"  shapefile not found at {shp_path} -- skipping")
        return 0

    features = []
    with fiona.open(shp_path) as src:
        for f in src:
            if f["geometry"] is None:
                continue
            props = dict(f["properties"])
            if feature_filter and not feature_filter(props):
                continue
            geom = force_2d(to_multi(reproject(shape(f["geometry"]))))
            row = map_fn(props, shp_path.stem)
            features.append((row, geom))
    print(f"  read {len(features)} features from {shp_filename}")

    if not features:
        print("  0 features -- table not created")
        return 0

    if dry_run:
        for row, _ in features[:5]:
            print(f"    sample: {row}")
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
        if "sector_no" in columns:
            cur.execute(
                f"CREATE INDEX IF NOT EXISTS {table}_sector_no_idx ON kumbh.{table} USING btree (sector_no)"
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


def supplement_public_service_facilities(conn, dry_run):
    """The 2027 gdb's Public_Service_Facilities/FSTP layers carry no subclass/services/
    category/bed data at all (every row null straight from _public_service_facilities_map)
    -- the 25 Aug 2026 shapefile drop has those columns filled in for the same 57
    facilities, matched here by nearest centroid (in the shared source CRS EPSG:32644, to
    within MATCH_RADIUS_M) plus 21 more Hospital/Health Camping rows the 2027 gdb doesn't
    carry at all (AIIMS 960-bed, Mela Hospital, Harmilap Mission 238-bed, ...). The
    shapefile's 9 electrical substations are deliberately skipped -- out of scope for a
    "public service facilities" evacuation layer; see PLAN-evacuation.md decision #11.

    Idempotent: always deletes any previously-appended source=SOURCE_TAG_SHP rows before
    re-matching/re-appending, so re-running never duplicates. Must be re-run after any
    full reload of this table (a plain `--only public_service_facilities` gdb run wipes
    every row back to null/57 via load_replace_table's TRUNCATE) -- main() does this
    automatically."""
    shp_path = SHP_2026_08_25_DIR / "Public_Service_Facilities.shp"
    print("\n=== public_service_facilities (supplement from 25 Aug shapefile) ===")
    if not shp_path.exists():
        print(f"  {shp_path} not found -- skipping supplement")
        return

    MATCH_RADIUS_M = 20

    with conn.cursor() as cur:
        # In --dry-run mode this runs *without* load_replace_table having actually added
        # the `source` column yet (dry-run returns before that ALTER) -- fall back to every
        # row in that case, since a fresh table has nothing but plain 2027 rows anyway. A
        # real run always reaches this after the ALTER has run for real, so the column is
        # there.
        cur.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema='kumbh' AND table_name='public_service_facilities' AND column_name='source'"
        )
        has_source_col = cur.fetchone() is not None
        if has_source_col:
            cur.execute(
                "SELECT id, ST_X(ST_Centroid(ST_Transform(geom, %s))), "
                "ST_Y(ST_Centroid(ST_Transform(geom, %s))) "
                "FROM kumbh.public_service_facilities WHERE source = %s",
                (SOURCE_SRID, SOURCE_SRID, SOURCE_TAG_2027),
            )
        else:
            cur.execute(
                "SELECT id, ST_X(ST_Centroid(ST_Transform(geom, %s))), "
                "ST_Y(ST_Centroid(ST_Transform(geom, %s))) "
                "FROM kumbh.public_service_facilities",
                (SOURCE_SRID, SOURCE_SRID),
            )
        gdb_rows = cur.fetchall()

    matched_ids = set()
    updates = []  # (id, subclass, services, category, bed)
    extra_features = []  # (row_dict, shapely_geom) for shapefile-only Hospital/Health Camping rows

    with fiona.open(shp_path) as src:
        for f in src:
            if f["geometry"] is None:
                continue
            p = dict(f["properties"])
            geom_utm = shape(f["geometry"])
            c = geom_utm.centroid
            best_id, best_d = None, None
            for gid, gx, gy in gdb_rows:
                d = ((gx - c.x) ** 2 + (gy - c.y) ** 2) ** 0.5
                if best_d is None or d < best_d:
                    best_id, best_d = gid, d
            ptype = clean(p.get("Type"))
            if best_id is not None and best_d is not None and best_d <= MATCH_RADIUS_M:
                matched_ids.add(best_id)
                updates.append(
                    (best_id, clean(p.get("Subclass")), clean(p.get("Services")), clean(p.get("Category")), clean(p.get("BED")))
                )
            elif ptype in ("Hospital", "Health Camping"):
                extra_features.append(
                    (
                        {
                            "name": clean(p.get("Name")),
                            "type": ptype,
                            "subclass": clean(p.get("Subclass")),
                            "services": clean(p.get("Services")),
                            "category": clean(p.get("Category")),
                            "bed": clean(p.get("BED")),
                            "shape_leng_src": p.get("SHAPE_Leng"),
                            "shape_area_src": p.get("SHAPE_Area"),
                            "source": SOURCE_TAG_SHP,
                        },
                        force_2d(to_multi(reproject(geom_utm))),
                    )
                )
            # else: an unmatched substation (or anything else not a hospital) -- skip.

    print(
        f"  matched {len(matched_ids)}/{len(gdb_rows)} gdb rows to shapefile facilities "
        f"(<= {MATCH_RADIUS_M}m); {len(extra_features)} shapefile-only Hospital/Health "
        f"Camping rows to append"
    )

    if dry_run:
        for row, _ in extra_features[:5]:
            print(f"    sample new row: {row}")
        return

    with conn.cursor() as cur:
        for gid, subclass, services, category, bed in updates:
            cur.execute(
                "UPDATE kumbh.public_service_facilities SET "
                "subclass = COALESCE(subclass, %s), "
                "services = COALESCE(services, %s), "
                "category = COALESCE(category, %s), "
                "bed = COALESCE(bed, %s) "
                "WHERE id = %s",
                (subclass, services, category, bed, gid),
            )
        cur.execute(
            "DELETE FROM kumbh.public_service_facilities WHERE source = %s", (SOURCE_TAG_SHP,)
        )
        if extra_features:
            cols = list(extra_features[0][0].keys())
            col_list = ", ".join(cols)
            placeholders = ", ".join(["%s"] * len(cols))
            sql = (
                f"INSERT INTO kumbh.public_service_facilities ({col_list}, geom) "
                f"VALUES ({placeholders}, ST_SetSRID(ST_GeomFromText(%s), {TARGET_SRID}))"
            )
            batch = [tuple(row.get(c) for c in cols) + (geom.wkt,) for row, geom in extra_features]
            psycopg2.extras.execute_batch(cur, sql, batch, page_size=200)
        conn.commit()
    print(
        f"  enriched {len(updates)} rows with subclass/services/category/bed where present; "
        f"appended {len(extra_features)} shapefile-only rows"
    )


def backfill_sector_zone(conn, dry_run):
    """Adds `zone` to kumbh.sector_boundary (see its REPLACE_SPECS extra_columns) and
    fills it in by matching sector NAME against the 25 Aug shapefile's own
    SECTOR_BOUNDARY_UPDATED, which carries a Zone column the 2027 gdb layer doesn't. All
    32 sector names match exactly between the two drops (checked 2026-09-15), so a name
    join is exact and needs no spatial fallback. See PLAN-evacuation.md §2.4."""
    shp_path = SHP_2026_08_25_DIR / "SECTOR_BOUNDARY_UPDATED.shp"
    print("\n=== sector_boundary.zone (backfill from 25 Aug shapefile) ===")
    if not shp_path.exists():
        print(f"  {shp_path} not found -- skipping zone backfill")
        return

    zone_by_name = {}
    with fiona.open(shp_path) as src:
        for f in src:
            p = dict(f["properties"])
            name = clean(p.get("Name"))
            zone = clean(p.get("Zone"))
            if name and zone:
                zone_by_name[name] = zone
    print(f"  read {len(zone_by_name)} sector->zone pairs from the shapefile")

    if dry_run:
        return

    with conn.cursor() as cur:
        cur.execute("ALTER TABLE kumbh.sector_boundary ADD COLUMN IF NOT EXISTS zone text")
        n = 0
        for name, zone in zone_by_name.items():
            cur.execute(
                "UPDATE kumbh.sector_boundary SET zone = %s WHERE name = %s", (zone, name)
            )
            n += cur.rowcount
        conn.commit()
        cur.execute("SELECT count(*) FROM kumbh.sector_boundary WHERE zone IS NULL")
        unmatched = cur.fetchone()[0]
    print(f"  set zone on {n} sectors" + (f" ({unmatched} sectors still unmatched)" if unmatched else ""))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Read + report counts, write nothing")
    parser.add_argument("--only", type=str, default=None, help="Comma-separated table names to run")
    parser.add_argument(
        "--source-root",
        type=str,
        default=None,
        help="Directory containing Kumbh_Mela_2027_V1_07_07/ and Kumbh_Mela_Shape/25_08_2026/ "
        "(default: \"Kumbh Data/\" at the repo root if present, else the repo root itself)",
    )
    args = parser.parse_args()

    only = set(args.only.split(",")) if args.only else None
    set_source_root(resolve_source_root(args.source_root))
    print(f"Source root: {SOURCE_ROOT}")

    if not GDB_PATH.exists():
        print(f"gdb not found at {GDB_PATH}", file=sys.stderr)
        sys.exit(1)
    if not SHP_2026_08_25_DIR.exists():
        print(
            f"warning: 25 Aug shapefile dir not found at {SHP_2026_08_25_DIR} -- "
            f"emergency_exit/hfl_area/hfl_line/zone/hospital-supplement will be skipped",
            file=sys.stderr,
        )

    conn = get_conn()
    results = {}

    # sector_boundary must load first: sector_plan/road's sector_no backfill (and this
    # script's own zone backfill) depend on spatially/name-joining against it.
    ordered_specs = sorted(REPLACE_SPECS, key=lambda s: 0 if s["table"] == "sector_boundary" else 1)

    try:
        for spec in ordered_specs:
            if only and spec["table"] not in only:
                continue
            results[spec["table"]] = load_replace_table(conn, spec, args.dry_run)
            if not args.dry_run and spec["table"] in ("sector_plan", "road"):
                backfill_sector_no(conn, spec["table"])
            if spec["table"] == "sector_boundary":
                backfill_sector_zone(conn, args.dry_run)
            if spec["table"] == "public_service_facilities":
                supplement_public_service_facilities(conn, args.dry_run)

        for table, columns, geom_type, layers, map_fn in NEW_TABLE_SPECS:
            if only and table not in only:
                continue
            results[table] = load_new_table(conn, table, columns, geom_type, layers, map_fn, args.dry_run)
            if not args.dry_run and table == "tertiary_road":
                dedupe_tertiary_road(conn)

        for table, columns, geom_type, shp_filename, map_fn, feature_filter in SHP_TABLE_SPECS:
            if only and table not in only:
                continue
            results[table] = load_shp_new_table(
                conn, table, columns, geom_type, shp_filename, map_fn, args.dry_run, feature_filter
            )
            # emergency_exit's Sector_Nam free text fails to parse a trailing "-NN" for 1 of
            # its 24 rows -- same spatial-join fallback as sector_plan/road above, reused
            # since backfill_sector_no only assumes `sector_no`/`geom` columns exist.
            if not args.dry_run and table == "emergency_exit":
                backfill_sector_no(conn, table)
    finally:
        conn.close()

    print("\n" + "=" * 50)
    print("SUMMARY" + (" (dry run -- nothing written)" if args.dry_run else ""))
    print("=" * 50)
    for table, count in results.items():
        print(f"  {table:30s} {count:>6} rows")


if __name__ == "__main__":
    main()
