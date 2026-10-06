// Main Heads and Sub-Heads for the Sector Readiness & Infrastructure Monitoring System, as supplied
// by the project team (13 heads; Head 14 has not been named yet, and the open "Sub 1.2" under
// Sanitation and the "more from images" Police entries are not included until they are).
// Names are kept as supplied so they stay searchable against the source list.
//
// Sub-heads that have their own children in the source (e.g. Toilets > Urinals) are flattened into
// one entry per leaf, named "Parent — Child". A head with no sub-heads gets one entry carrying the
// head's own name so progress can still be tracked against it.
//
// `unit` is the primary measurement for each entry. `depts` are the responsible departments that
// demo data draws from -- placeholders until the real owners are set.

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
    subs: [s('Levelling and Dressing', 'Sq. m.'), s('Road Marking', 'm')],
  },
  {
    no: '02',
    name: 'Road Infrastructure',
    purpose: 'Ensure regular, service and emergency vehicular/pedestrian access',
    depts: ['PWD', 'Nagar Nigam', 'Mela Adhikari'],
    subs: [s('Road Infrastructure', 'km')],
  },
  {
    no: '03',
    name: 'Electrical Department',
    purpose: 'Provide power supply, distribution and adequate lighting',
    depts: ['UPCL', 'Electricity Department', 'PWD (Electrical)'],
    subs: [
      s('Electrical Pole Installation', 'poles'),
      s('Transformers', 'KVA'),
      s('Electrical Cables', 'm'),
      s('Street Lighting', 'nos.'),
    ],
  },
  {
    no: '04',
    name: 'Water Supply & Distribution',
    purpose: 'Ensure adequate drinking and utility water supply',
    depts: ['Peyjal Nigam', 'Jal Sansthan'],
    subs: [
      s('Internal Water Distribution Network', 'm'),
      s('Temporary water supply pipeline', 'm'),
      s('Public Water points', 'nos.'),
    ],
  },
  {
    no: '05',
    name: 'Tentage - Administrative and Police',
    purpose: 'Establish camps, tentage and temporary establishments',
    depts: ['Mela Adhikari', 'Akhara Parishad Liaison', 'Tentage Contractor'],
    subs: [s('Akhara', 'Sq. m.'), s('Police/PAC Camps', 'nos.'), s('Administrative', 'nos.')],
  },
  {
    no: '06',
    name: 'Sanitation and Solid waste',
    purpose: 'Provide sanitation facilities and manage solid waste',
    depts: ['Nagar Nigam', 'Sanitation Wing', 'Swachh Bharat Mission'],
    subs: [
      s('Toilets — Urinals', 'nos.'),
      s('Dustbins — Plain dustbin', 'nos.'),
      s('Dustbins — IoT dustbin', 'nos.'),
      s('MTS (micro transfer stations)', 'nos.'),
      s('FSTP (Fecal Sludge Treatment Plant)', 'nos.'),
    ],
  },
  {
    no: '07',
    name: 'Telecommunication',
    purpose: 'Enable sector-level command, communication and connectivity',
    depts: ['IT Department', 'BSNL / Telecom', 'Mela Control Room'],
    subs: [s('Towers', 'nos.')],
  },
  {
    no: '08',
    name: 'ISBT',
    purpose: 'Provide inter-state bus terminal facilities for pilgrim arrival and departure',
    depts: ['Transport Department', 'PWD', 'Mela Adhikari'],
    subs: [s('Bus Stand', 'nos.')],
  },
  {
    no: '09',
    name: 'Fire Safety',
    purpose: 'Ensure fire protection and emergency response infrastructure',
    depts: ['Fire Service', 'SDRF', 'Disaster Management'],
    subs: [
      s('Fire station', 'nos.'),
      s('Fire chowky', 'nos.'),
      s('Fire brigade', 'nos.'),
      s('Fire Hydrant', 'nos.'),
    ],
  },
  {
    no: '10',
    name: 'Medical and Health Infra',
    purpose: 'Provide medical facilities and monitor public health',
    depts: ['Health Department', 'CMO Office', 'AYUSH Department'],
    subs: [
      s('Homeopathic — Clinic', 'nos.'),
      s('Ayurvedic — Clinic', 'nos.'),
      s('Ayurvedic — Yoga Centre', 'nos.'),
      s('Allopathic — Clinic', 'nos.'),
      s('Allopathic — Hospitals', 'nos.'),
      s('Allopathic — Primary Healthcare Centre', 'nos.'),
      s('Allopathic — First Aid', 'nos.'),
    ],
  },
  {
    no: '11',
    name: 'Police and Security',
    purpose: 'Establish security, surveillance and access-control arrangements',
    depts: ['Police', 'PAC', 'ITBP'],
    subs: [
      s('Police station', 'nos.'),
      s('Police chowki', 'nos.'),
      s('Police Line', 'nos.'),
      s('Police Hospital', 'nos.'),
      s('ITBP', 'nos.'),
    ],
  },
  {
    no: '12',
    name: 'Signage',
    purpose: 'Provide directional, information and safety signage',
    depts: ['Mela Adhikari', 'PWD', 'Tourism Department'],
    subs: [s('Signage', 'nos.')],
  },
  {
    no: '13',
    name: 'Parking',
    purpose: 'Manage pilgrim, pedestrian and vehicular parking',
    depts: ['Traffic Police', 'Mela Adhikari', 'Transport Department'],
    subs: [
      s('Camera Installation', 'nos.'),
      s('Barricading', 'm'),
      s('Ticketing Counters', 'nos.'),
      s('Parking, Marking and Boundary', 'Sq. m.'),
    ],
  },
]
