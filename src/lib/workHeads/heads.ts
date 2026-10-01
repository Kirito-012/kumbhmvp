// Main Heads and Sub-Heads for the Sector Readiness & Infrastructure Monitoring System, transcribed
// from "Kumbh Mela 2027 – Haridwar - Main Heads and Sub-Heads" (proposed for administrative
// approval). Names are kept verbatim so they stay searchable against the source document.
//
// `unit` is the primary measurement for each sub-head (the doc lists a set per head, e.g.
// "metres, km, KL capacity, nos., locations"); `details` carries the doc's nested bullet points.
// `depts` are the responsible departments that demo data draws from -- the doc names none except
// Peyjal Nigam in its worked example, so the rest are placeholders until the real owners are set.

export type WorkUnit =
  | 'm'
  | 'km'
  | 'Sq. m.'
  | 'Cu. m.'
  | 'nos.'
  | 'KL'
  | 'KVA'
  | 'poles'
  | 'persons'
  | 'tonnes/day'
  | 'samples'
  | 'beds'
  | 'routes'

export type WorkSubHead = { name: string; unit: WorkUnit; details?: string[] }
export type WorkHead = {
  no: string
  name: string
  purpose: string
  depts: string[]
  subs: WorkSubHead[]
}

const s = (name: string, unit: WorkUnit, details?: string[]): WorkSubHead => ({
  name,
  unit,
  ...(details ? { details } : {}),
})

export const WORK_HEADS: WorkHead[] = [
  {
    no: '01',
    name: 'Site Clearance & Ground Development',
    purpose: 'Prepare and develop land for camps, roads, facilities and public use',
    depts: ['Mela Adhikari', 'Irrigation Department', 'PWD'],
    subs: [
      s('Clearing & Grubbing', 'Sq. m.', [
        'Removal of grass, weeds, bushes, shrubs and unwanted vegetation',
        'Removal of roots/stumps where applicable',
        'Removal of organic/unserviceable material',
      ]),
      s('Debris & Obstruction Removal', 'Cu. m.', [
        'Construction debris',
        'Existing waste',
        'Unserviceable material',
        'Physical obstructions',
      ]),
      s('Earth Filling & Ground Raising', 'Cu. m.'),
      s('Ground Levelling & Grading', 'Sq. m.'),
      s('Surface Preparation & Compaction', 'Sq. m.'),
      s('Site Demarcation & Layout', 'Sq. m.'),
      s('Camp / Facility Plot Preparation', 'nos.'),
    ],
  },
  {
    no: '02',
    name: 'Roads, Access & Mobility Infrastructure',
    purpose: 'Ensure regular, service and emergency vehicular/pedestrian access',
    depts: ['PWD', 'Nagar Nigam', 'Mela Adhikari'],
    subs: [
      s('Approach & Main Access Roads', 'km'),
      s('Internal Sector & Camp Access Roads', 'km'),
      s('Service & Utility Access Roads', 'km', [
        'Waste collection vehicles',
        'Water tankers',
        'Sewerage maintenance vehicles',
        'Supply vehicles',
        'Other essential service vehicles',
      ]),
      s('Emergency Access Roads', 'km', [
        'Fire tender access',
        'Ambulance access',
        'Emergency response vehicles',
        'Evacuation access',
      ]),
      s('Road Formation, Levelling & Surface Preparation', 'Sq. m.', [
        'Dressing',
        'Levelling',
        'Grading',
        'Surface preparation',
        'WBM / other approved road surface treatment as applicable',
      ]),
      s('Road Repair & Strengthening', 'km'),
      s('Pedestrian Circulation & Walkways', 'm', [
        'Pedestrian routes',
        'Footpaths',
        'Walkways',
        'Pedestrian access to camps/facilities',
      ]),
      s('Road Shoulders & Edge Treatment', 'm'),
      s('Road Signage, Markings & Delineation', 'nos.'),
    ],
  },
  {
    no: '03',
    name: 'Water Supply & Distribution',
    purpose: 'Ensure adequate drinking and utility water supply',
    depts: ['Peyjal Nigam', 'Jal Sansthan'],
    subs: [
      s('Main / Temporary Water Supply Pipeline', 'm'),
      s('Internal Water Distribution Network', 'm'),
      s('Water Standposts / Public Water Points', 'nos.'),
      s('Drinking Water Points', 'nos.'),
      s('PVC Water Storage Tanks', 'KL'),
      s('Temporary Water Connections', 'nos.'),
      s('Water Tanker Filling / Supply Points', 'nos.'),
      s('Water Filtration / Treatment Units', 'nos.'),
      s('Water Pressure Testing', 'm'),
      s('Water Quality Testing', 'samples'),
      s('Leakage Detection & Rectification', 'nos.'),
    ],
  },
  {
    no: '04',
    name: 'Sewerage, Drainage & Wastewater Management',
    purpose: 'Ensure collection, drainage and safe disposal of wastewater',
    depts: ['Jal Sansthan', 'Nagar Nigam', 'Peyjal Nigam'],
    subs: [
      s('Sewerage Network & Connections', 'm', [
        'Sewer lines',
        'Camp/facility connections',
        'Main and internal sewer network',
      ]),
      s('Manholes & Inspection Chambers', 'nos.'),
      s('Internal Drainage Network', 'm'),
      s('Storm Water Drainage', 'm'),
      s('Open / Covered Drains', 'm'),
      s('Drain Crossings & Culverts', 'nos.'),
      s('Drain Cleaning & Desilting', 'm'),
      s('Wastewater Collection & Disposal', 'KL'),
      s('Dewatering Arrangements', 'nos.'),
      s('Waterlogging Mitigation', 'nos.'),
    ],
  },
  {
    no: '05',
    name: 'Electrical Supply & Lighting Infrastructure',
    purpose: 'Provide power supply, distribution and adequate lighting',
    depts: ['UPCL', 'Electricity Department', 'PWD (Electrical)'],
    subs: [
      s('Electrical Pole Installation', 'poles'),
      s('HT / LT Distribution Network', 'km'),
      s('Temporary Electrical Connections', 'nos.'),
      s('Electrical Cables & Distribution Panels', 'm'),
      s('Transformers / Distribution Transformers', 'KVA'),
      s('Street Lighting', 'nos.'),
      s('Camp & Facility Lighting', 'nos.'),
      s('High-Mast Lighting', 'nos.'),
      s('Parking & Road Lighting', 'nos.'),
      s('DG / Generator Backup', 'KVA'),
      s('Electrical Earthing & Safety', 'nos.'),
      s('Dark Spot Identification & Rectification', 'nos.'),
    ],
  },
  {
    no: '06',
    name: 'Tentage, Akhara & Temporary Camp Infrastructure',
    purpose: 'Establish camps, tentage and temporary establishments',
    depts: ['Mela Adhikari', 'Akhara Parishad Liaison', 'Tentage Contractor'],
    subs: [
      s('Akhara / Religious Institution Camp Areas', 'Sq. m.'),
      s('Sadhus / Sant Camp Areas', 'Sq. m.'),
      s('Pilgrim Accommodation / Camp Areas', 'Sq. m.'),
      s('Mela Administration Camps', 'nos.'),
      s('Sector Office & Control Room', 'nos.'),
      s('Police / PAC Camps', 'nos.'),
      s('Medical Camps', 'nos.'),
      s('Fire & Emergency Posts', 'nos.'),
      s('Staff / Worker Accommodation', 'nos.'),
      s('Volunteer Camps', 'nos.'),
      s('Kitchen / Bhandara Facilities', 'nos.'),
      s('Food Distribution Areas', 'nos.'),
      s('Storage / Material Camps', 'nos.'),
      s('Resting / Waiting Shelters', 'nos.'),
      s('Changing Facilities', 'nos.'),
      s('Temporary Platforms & Structures', 'nos.'),
    ],
  },
  {
    no: '07',
    name: 'Sanitation & Solid Waste Management',
    purpose: 'Provide sanitation facilities and manage solid waste',
    depts: ['Nagar Nigam', 'Sanitation Wing', 'Swachh Bharat Mission'],
    subs: [
      s('Public Toilet Blocks', 'nos.'),
      s('Urinals', 'nos.'),
      s('Mobile / Temporary Toilets', 'nos.'),
      s('Pink Toilets / Women’s Sanitation Facilities', 'nos.'),
      s('Toilet Water & Sewerage Connections', 'nos.'),
      s('Toilet Cleaning & Maintenance', 'nos.'),
      s('Waste Collection Points', 'nos.'),
      s('Dustbins / Waste Bins', 'nos.'),
      s('Solid Waste Collection', 'tonnes/day'),
      s('Waste Transportation', 'tonnes/day'),
      s('Waste Processing / Disposal', 'tonnes/day'),
      s('Sweeping & Cleaning', 'km'),
      s('Sanitation Workforce Deployment', 'persons'),
      s('Vector / Pest Control', 'nos.'),
    ],
  },
  {
    no: '08',
    name: 'Fire Safety & Emergency Preparedness',
    purpose: 'Ensure fire protection and emergency response infrastructure',
    depts: ['Fire Service', 'SDRF', 'Disaster Management'],
    subs: [
      s('Fire Hydrants', 'nos.'),
      s('Fire Water Storage', 'KL'),
      s('Fire Extinguishers & Equipment', 'nos.'),
      s('Fire Tender Access', 'routes'),
      s('Fire Response Posts', 'nos.'),
      s('Emergency Access Routes', 'routes'),
      s('Emergency Exits', 'nos.'),
      s('Emergency Assembly Areas', 'nos.'),
      s('Fire Safety Inspection', 'nos.'),
      s('Emergency Response Equipment', 'nos.'),
      s('Fire Response Personnel', 'persons'),
    ],
  },
  {
    no: '09',
    name: 'Medical & Public Health Infrastructure',
    purpose: 'Provide medical facilities and monitor public health',
    depts: ['Health Department', 'CMO Office', 'Pollution Control Board'],
    subs: [
      s('Temporary Hospitals', 'nos.'),
      s('Sector Medical Centres', 'nos.'),
      s('Medical Camps', 'nos.'),
      s('First-Aid Posts', 'nos.'),
      s('Ambulance Points', 'nos.'),
      s('Emergency Medical Response Points', 'nos.'),
      s('Medical Beds & Equipment', 'beds'),
      s('Medical Personnel Deployment', 'persons'),
      s('Ganga River Water Quality Monitoring & Sampling', 'samples', [
        'Sampling locations',
        'Sampling frequency',
        'Laboratory testing',
        'Water quality parameters',
        'Test results/compliance',
      ]),
      s('Drinking Water Quality Testing', 'samples'),
      s('Public Health Inspection', 'nos.'),
      s('Vector & Disease Control', 'nos.'),
    ],
  },
  {
    no: '10',
    name: 'Police, Security & Surveillance',
    purpose: 'Establish security, surveillance and access-control arrangements',
    depts: ['Police', 'PAC', 'IT / Surveillance Cell'],
    subs: [
      s('Police Camps', 'nos.'),
      s('Police Posts / Checkpoints', 'nos.'),
      s('PAC / Security Camps', 'nos.'),
      s('Entry Security Points', 'nos.'),
      s('CCTV Installation', 'nos.'),
      s('CCTV Monitoring Points', 'nos.'),
      s('Watch Towers / Observation Points', 'nos.'),
      s('Security Barricading', 'm'),
      s('Access Control Points', 'nos.'),
      s('Security Control Room', 'nos.'),
      s('Police / Security Personnel Deployment', 'persons'),
      s('Security Lighting', 'nos.'),
    ],
  },
  {
    no: '11',
    name: 'Traffic, Parking & Crowd Management',
    purpose: 'Manage pilgrim, pedestrian and vehicular movement',
    depts: ['Traffic Police', 'Mela Adhikari', 'Transport Department'],
    subs: [
      s('Mela Parking Areas', 'Sq. m.'),
      s('Bus Parking Areas', 'Sq. m.'),
      s('Two-Wheeler Parking Areas', 'Sq. m.'),
      s('Entry & Exit Routes', 'routes'),
      s('Pedestrian Entry / Exit Routes', 'routes'),
      s('Drop-off / Pick-up Zones', 'nos.'),
      s('Traffic Diversion Routes', 'routes'),
      s('Traffic Control Points', 'nos.'),
      s('Crowd Holding Areas', 'Sq. m.'),
      s('Queue Management Areas', 'Sq. m.'),
      s('Pedestrian Corridors', 'm'),
      s('Traffic Barricading', 'm'),
      s('Emergency / Evacuation Routes', 'routes'),
      s('Traffic Signage', 'nos.'),
      s('Parking Illumination', 'nos.'),
    ],
  },
  {
    no: '12',
    name: 'Ghat, Bathing & Riverfront Safety',
    purpose: 'Ensure safe bathing, river access and water-edge management',
    depts: ['Irrigation Department', 'Jal Police', 'Mela Adhikari'],
    subs: [
      s('Ghat Access & Approach', 'm'),
      s('Ghat Surface / Steps', 'Sq. m.'),
      s('Bathing Area Preparation', 'Sq. m.'),
      s('Ramps & Accessible Access', 'nos.'),
      s('Safety Railings / Handrails', 'm'),
      s('River-Edge Barricading', 'm'),
      s('Ghat Lighting', 'nos.'),
      s('Changing Facilities', 'nos.'),
      s('Ghat Sanitation', 'nos.'),
      s('Drinking Water Facilities', 'nos.'),
      s('Life-Saving Equipment', 'nos.'),
      s('Water Rescue / Jal Police Points', 'nos.'),
      s('Emergency Access', 'routes'),
      s('Riverbank / Water-Edge Protection', 'm'),
      s('Observation / Watch Points', 'nos.'),
    ],
  },
  {
    no: '13',
    name: 'Pilgrim & Public Amenities',
    purpose: 'Provide essential facilities and services for pilgrims/public',
    depts: ['Mela Adhikari', 'Nagar Nigam', 'Tourism Department'],
    subs: [
      s('Drinking Water Points', 'nos.'),
      s('Resting & Shaded Areas', 'Sq. m.'),
      s('Seating Facilities', 'nos.'),
      s('Information / Help Desks', 'nos.'),
      s('Directional & Wayfinding Signage', 'nos.'),
      s('Public Information Boards', 'nos.'),
      s('Public Announcement System', 'nos.'),
      s('Changing Rooms', 'nos.'),
      s('Cloakrooms / Storage Facilities', 'nos.'),
      s('Accessibility Infrastructure', 'nos.'),
      s('Accessible Toilets', 'nos.'),
      s('Wheelchair Ramps', 'nos.'),
      s('Public Utility / Charging Points', 'nos.'),
    ],
  },
  {
    no: '14',
    name: 'Communication, Control & Information Systems',
    purpose: 'Enable sector-level command, communication and public information',
    depts: ['IT Department', 'BSNL / Telecom', 'Mela Control Room'],
    subs: [
      s('Sector Control Room', 'nos.'),
      s('Departmental Communication Points', 'nos.'),
      s('Public Address System', 'nos.'),
      s('Digital Information Displays', 'nos.'),
      s('Information Kiosks', 'nos.'),
      s('CCTV / Surveillance Connectivity', 'nos.'),
      s('Wireless / Radio Communication', 'nos.'),
      s('Emergency Communication System', 'nos.'),
      s('Sector Information Boards', 'nos.'),
      s('Control-Room Connectivity', 'nos.'),
    ],
  },
]
