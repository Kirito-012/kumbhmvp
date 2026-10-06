import type { QuestionnaireTemplate } from '@/lib/questionnaire/general-camping'

/**
 * The Toilets Questionnaire — filled in by a Surveyor on tickets whose parcel is a toilet block
 * (see `templateKeyForLocation` in general-camping.ts). Source: the RFP specifications for
 * "Prefabricated steel-based toilets with septic tank on rental basis" (Kumbh 2027 – Haridwar),
 * sections A (structural), B (water & plumbing), C (septic tank & utility), D (accessibility).
 * Only the 16 checks the project team picked from the RFP are included.
 *
 * Question ids are stable slugs and are persisted on submissions -- never rename one.
 * DRAFT: wording is awaiting review by the project team.
 */
export const TOILETS: QuestionnaireTemplate = {
  key: 'toilets',
  version: 1,
  title: 'Toilets Questionnaire',
  sections: [
    {
      id: 'structure',
      title: 'Structure',
      questions: [
        {
          id: 'door',
          no: 1,
          parameter: 'Door',
          prompt: 'Does every toilet unit have a lockable door with an occupancy indicator?',
          kind: 'yes_no',
        },
        {
          id: 'min_size_per_unit',
          no: 2,
          parameter: 'Minimum size per unit',
          prompt:
            'Is each toilet unit at least 3 ft × 3 ft × 7 ft (length × width × height)? If not, record the actual size.',
          kind: 'yes_no_size',
          unit: 'ft',
        },
        {
          id: 'structural_framework',
          no: 3,
          parameter: 'Structural framework',
          prompt:
            'Is the frame made of MS angle 40 × 40 × 5 mm or stronger (or an equal-strength MS hollow section), and free of rust, bends or damage?',
          kind: 'yes_no',
        },
        {
          id: 'lighting',
          no: 4,
          parameter: 'Lighting',
          prompt: 'Is the lighting working in every unit and across the toilet cluster?',
          kind: 'yes_no',
        },
      ],
    },
    {
      id: 'water_plumbing',
      title: 'Water & Plumbing',
      questions: [
        {
          id: 'wash_basin',
          no: 5,
          parameter: 'Wash basins',
          prompt:
            'Are 2 common wash basins, with controlled water supply, provided outside for every 10-seat toilet cluster?',
          kind: 'required_actual',
          unit: 'basins',
        },
        {
          id: 'water_availability',
          no: 6,
          parameter: 'Water availability',
          prompt:
            'Is water continuously available (supplied outside the blocks, with mugs and buckets for users)?',
          kind: 'yes_no',
        },
        {
          id: 'soap_dispenser',
          no: 7,
          parameter: 'Soap dispenser',
          prompt: 'Is a soap dispenser provided near the wash basins?',
          kind: 'yes_no',
        },
        {
          id: 'overflow_protection',
          no: 8,
          parameter: 'Overflow protection',
          prompt: 'Is overflow protection fitted on the water tank?',
          kind: 'yes_no',
        },
      ],
    },
    {
      id: 'septic_tank',
      title: 'Septic Tank & Utility',
      questions: [
        {
          id: 'containment_capacity',
          no: 9,
          parameter: 'Containment capacity',
          prompt:
            'Septic containment capacity of this block (minimum 1,000 litres per cabin; 2,500 litres for every cluster of 10 cabins).',
          kind: 'required_actual',
          unit: 'litres',
        },
        {
          id: 'additional_cluster_tank',
          no: 10,
          parameter: 'Additional cluster tank',
          prompt: 'Is an additional cluster tank of at least 3,000 litres provided per 10 toilets?',
          kind: 'required_actual',
          unit: 'litres',
        },
        {
          id: 'tank_monitoring',
          no: 11,
          parameter: 'Tank monitoring',
          prompt: 'Is there a working tank-level indicator (mechanical or float-based)?',
          kind: 'yes_no',
        },
        {
          id: 'odour_control',
          no: 12,
          parameter: 'Odour control',
          prompt: 'Is deodourisation arrangement in place and working?',
          kind: 'yes_no',
        },
      ],
    },
    {
      id: 'accessibility',
      title: 'Accessibility & User Convenience',
      questions: [
        {
          id: 'accessibility_signage',
          no: 13,
          parameter: 'Signage',
          prompt: 'Is accessibility signage displayed at the toilets?',
          kind: 'yes_no',
        },
        {
          id: 'waste_bin',
          no: 14,
          parameter: 'Waste bin',
          prompt: 'Is a waste bin provided in each unit?',
          kind: 'yes_no',
        },
        {
          id: 'mirror_and_hooks',
          no: 15,
          parameter: 'Mirror and hooks',
          prompt: 'Are a mirror and hooks provided in each unit?',
          kind: 'yes_no',
        },
        {
          id: 'access_ramp',
          no: 16,
          parameter: 'Access ramp',
          prompt: 'Is an access ramp provided for the accessible toilet?',
          kind: 'yes_no_na',
        },
      ],
    },
  ],
}
