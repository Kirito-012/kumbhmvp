/**
 * The General Camping Questionnaire — a Surveyor fills this in from a ticket's detail page after
 * physically inspecting the site. Source: `General_Camping_Questionnaire.docx` (project root).
 *
 * `id` is a stable slug and is the only thing ever persisted on a TicketQuestionnaire.answers row
 * — it must never change once surveys exist. `no` is purely a display number; the docx had gaps
 * (13, 17-19, 33, 39) and a duplicate 41, so display numbers here are renumbered 1..39 for
 * readability. Three rows were incomplete in the source doc and were authored to be sensible:
 * see `no` 15 (Road Shoulder — no answer format given, assumed required/actual), 16 (Back
 * Alley — no question text given at all), and 20 (Highly combustible material — no answer
 * format given, assumed yes/no).
 *
 * `templateKey` + `version` are snapshotted onto every submitted response (see
 * TicketQuestionnaire model) so edits here never retroactively change what a past survey meant.
 */

export type AnswerKind =
  | 'yes_no'
  | 'yes_no_na'
  | 'measurement'
  | 'dimensions'
  | 'required_actual'
  | 'yes_no_measure'
  | 'text'

export type Question = {
  id: string
  no: number
  parameter: string
  prompt: string
  kind: AnswerKind
  unit?: string
}

export type Section = {
  id: string
  title: string
  questions: Question[]
}

export type QuestionnaireTemplate = {
  key: string
  version: number
  title: string
  sections: Section[]
}

export const GENERAL_CAMPING: QuestionnaireTemplate = {
  key: 'general_camping',
  version: 1,
  title: 'General Camping Questionnaire',
  sections: [
    {
      id: 'plot_and_site',
      title: 'Plot & Site',
      questions: [
        {
          id: 'plot_identification',
          no: 1,
          parameter: 'Plot identification',
          prompt: 'Is the camp/plot located within the designated camping area?',
          kind: 'yes_no',
        },
        {
          id: 'plot_dimensions',
          no: 2,
          parameter: 'Plot dimensions',
          prompt: 'Length and width of the camping plot as per approved plan?',
          kind: 'dimensions',
          unit: 'm',
        },
        {
          id: 'plot_area',
          no: 3,
          parameter: 'Plot area',
          prompt: 'Does the measured plot area correspond with the approved plan?',
          kind: 'measurement',
          unit: 'sq.m',
        },
        {
          id: 'setback_road',
          no: 4,
          parameter: 'Setback from road',
          prompt: 'Is the prescribed front setback maintained from the internal road/ROW?',
          kind: 'required_actual',
          unit: 'm',
        },
        {
          id: 'setback_side',
          no: 5,
          parameter: 'Side setback',
          prompt: 'Are prescribed side setbacks maintained from adjacent plots/structures?',
          kind: 'required_actual',
          unit: 'm',
        },
        {
          id: 'setback_rear',
          no: 6,
          parameter: 'Rear setback',
          prompt: 'Is the prescribed rear setback maintained?',
          kind: 'required_actual',
          unit: 'm',
        },
        {
          id: 'separation_permanent_structures',
          no: 7,
          parameter: 'Separation from permanent structures',
          prompt: 'Is the prescribed distance maintained from permanent buildings/structures?',
          kind: 'measurement',
          unit: 'm',
        },
      ],
    },
    {
      id: 'camp_safety_road_access',
      title: 'Camp-to-Camp Safety & Road Access',
      questions: [
        {
          id: 'fire_separation',
          no: 8,
          parameter: 'Fire separation',
          prompt: 'Is adequate separation maintained between camps to prevent fire spread?',
          kind: 'yes_no_measure',
          unit: 'm',
        },
        {
          id: 'tent_orientation',
          no: 9,
          parameter: 'Tent orientation',
          prompt:
            'Are tents oriented (Entry/Exit) as per the approved layout/planning requirement?',
          kind: 'yes_no',
        },
        {
          id: 'emergency_access',
          no: 10,
          parameter: 'Emergency access',
          prompt: 'Is there unobstructed emergency access between camp clusters?',
          kind: 'yes_no',
        },
        {
          id: 'fire_tender_access',
          no: 11,
          parameter: 'Fire tender access',
          prompt:
            'Can emergency/fire vehicles access the camping area? (Minimum 6-meter ROW width for all roads followed)',
          kind: 'yes_no',
        },
        {
          id: 'plot_over_60m_width',
          no: 12,
          parameter: 'Plot >60 m width',
          prompt:
            'Where the plot/camping block exceeds 60 m in width, has an additional internal access road/fire access of 6 meters been provided as required?',
          kind: 'yes_no_na',
        },
        {
          id: 'road_obstruction',
          no: 13,
          parameter: 'Road obstruction',
          prompt:
            'Are poles, stalls, ropes, parked vehicles or other structures obstructing the internal road?',
          kind: 'yes_no',
        },
        {
          id: 'road_shoulder',
          no: 14,
          parameter: 'Road shoulder',
          prompt: 'Is a minimum 1.5-meter shoulder (utility corridor) provided for each road?',
          kind: 'required_actual',
          unit: 'm',
        },
        {
          id: 'back_alley',
          no: 15,
          parameter: 'Back alley',
          prompt: 'Is a back alley provided as per the approved layout?',
          kind: 'yes_no_na',
        },
      ],
    },
    {
      id: 'kitchen_fire_safety',
      title: 'Kitchen & Fire Safety',
      questions: [
        {
          id: 'kitchen_location',
          no: 16,
          parameter: 'Kitchen location',
          prompt: 'Is the kitchen located in the designated camp approved?',
          kind: 'yes_no',
        },
        {
          id: 'kitchen_separation',
          no: 17,
          parameter: 'Kitchen separation',
          prompt:
            'Is the prescribed distance maintained between kitchen and sleeping/accommodation tents?',
          kind: 'required_actual',
          unit: 'm',
        },
        {
          id: 'kitchen_roofing',
          no: 18,
          parameter: 'Kitchen roofing',
          prompt: 'Is the kitchen provided with tin/metal roofing only, as prescribed?',
          kind: 'yes_no',
        },
        {
          id: 'combustible_material',
          no: 19,
          parameter: 'Combustible material',
          prompt: 'Are combustible materials stored away from the kitchen/cooking area?',
          kind: 'yes_no',
        },
        {
          id: 'highly_combustible_material',
          no: 20,
          parameter: 'Highly combustible material',
          prompt:
            'Is it confirmed that no highly combustible material is stored inside the camping area?',
          kind: 'yes_no',
        },
        {
          id: 'lpg_cylinder',
          no: 21,
          parameter: 'LPG/gas cylinder',
          prompt: 'Are LPG cylinders stored safely in the designated area?',
          kind: 'yes_no',
        },
        {
          id: 'fire_extinguisher',
          no: 22,
          parameter: 'Fire extinguisher',
          prompt: 'Is a functional fire extinguisher available near the kitchen?',
          kind: 'yes_no',
        },
        {
          id: 'open_flame',
          no: 23,
          parameter: 'Open flame',
          prompt: 'Is open flame restricted to the designated kitchen area?',
          kind: 'yes_no',
        },
        {
          id: 'kitchen_electrical_safety',
          no: 24,
          parameter: 'Electrical safety',
          prompt:
            'Are electrical connections to kitchen/tents safely installed without exposed wiring?',
          kind: 'yes_no',
        },
      ],
    },
    {
      id: 'utilities_sanitation',
      title: 'Utilities & Sanitation',
      questions: [
        {
          id: 'toilet_location',
          no: 25,
          parameter: 'Toilet location',
          prompt:
            'Are toilets located at the prescribed distance from accommodation/kitchen areas (18 meters minimum)?',
          kind: 'required_actual',
          unit: 'm',
        },
        {
          id: 'drinking_water',
          no: 26,
          parameter: 'Drinking water',
          prompt: 'Is drinking water facility provided at the prescribed location?',
          kind: 'yes_no',
        },
        {
          id: 'drainage',
          no: 27,
          parameter: 'Drainage',
          prompt: 'Is adequate drainage provided around the camp?',
          kind: 'yes_no',
        },
        {
          id: 'waste_disposal',
          no: 28,
          parameter: 'Waste disposal',
          prompt: 'Is a designated waste collection point provided outside camp (50 meters)?',
          kind: 'yes_no',
        },
        {
          id: 'waste_separation',
          no: 29,
          parameter: 'Waste separation',
          prompt: 'Are wet/dry waste bins provided within camps?',
          kind: 'yes_no',
        },
      ],
    },
    {
      id: 'electrical_structural_safety',
      title: 'Electrical & Structural Safety',
      questions: [
        {
          id: 'electrical_clearance',
          no: 30,
          parameter: 'Electrical clearance',
          prompt:
            'Are tents/temporary structures adequately separated from electrical lines/poles?',
          kind: 'yes_no',
        },
        {
          id: 'temporary_wiring',
          no: 31,
          parameter: 'Temporary wiring',
          prompt: 'Is temporary electrical wiring properly protected and routed?',
          kind: 'yes_no',
        },
        {
          id: 'tent_anchoring',
          no: 32,
          parameter: 'Tent anchoring',
          prompt: 'Are tents properly anchored and secured against wind?',
          kind: 'yes_no',
        },
        {
          id: 'structural_stability',
          no: 33,
          parameter: 'Structural stability',
          prompt: 'Are temporary structures stable and free from visible defects?',
          kind: 'yes_no',
        },
        {
          id: 'emergency_exit',
          no: 34,
          parameter: 'Emergency exit',
          prompt: 'Is an unobstructed emergency exit/escape route available?',
          kind: 'yes_no',
        },
      ],
    },
    {
      id: 'general_compliance',
      title: 'General Compliance',
      questions: [
        {
          id: 'encroachment',
          no: 35,
          parameter: 'Encroachment',
          prompt:
            'Has any camp, kitchen, toilet, stall or other structure extended beyond the approved plot boundary?',
          kind: 'yes_no',
        },
        {
          id: 'kitchen_mess_separation',
          no: 36,
          parameter: 'Kitchen/mess separation',
          prompt: 'Has the kitchen/mess been separated at least 5 meters from other tents?',
          kind: 'yes_no',
        },
        {
          id: 'setback_violation',
          no: 37,
          parameter: 'Setback violation',
          prompt: 'Is any temporary structure located within the prohibited setback?',
          kind: 'yes_no',
        },
        {
          id: 'road_encroachment',
          no: 38,
          parameter: 'Road encroachment',
          prompt: 'Has any portion of the camp occupied the prescribed road/clear access zone?',
          kind: 'yes_no',
        },
        {
          id: 'fire_access_obstruction',
          no: 39,
          parameter: 'Fire access obstruction',
          prompt: 'Is any fire/emergency access route blocked?',
          kind: 'yes_no',
        },
      ],
    },
  ],
}

export const QUESTIONNAIRE_TEMPLATES = { [GENERAL_CAMPING.key]: GENERAL_CAMPING } as const

export function getTemplate(key: string): QuestionnaireTemplate | null {
  return QUESTIONNAIRE_TEMPLATES[key as keyof typeof QUESTIONNAIRE_TEMPLATES] ?? null
}

export function allQuestions(template: QuestionnaireTemplate): Question[] {
  return template.sections.flatMap((s) => s.questions)
}

export function totalQuestionCount(template: QuestionnaireTemplate): number {
  return allQuestions(template).length
}
