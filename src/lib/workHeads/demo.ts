import { WORK_HEADS, type WorkUnit } from '@/lib/workHeads/heads'

// DEMO DATA. There is no store for head/sub-head progress yet, so every figure here is generated
// deterministically from (sector, head, sub-head) -- the same sector always shows the same numbers,
// and different sectors differ. The UI labels all of it "Demo"; replace `buildSectorWorkHeads`
// with a real fetch when the data exists and the rest of the pipeline stays as it is.
//
// Measurement logic follows the source document:
//   Required → Planned → Completed → Balance → % Completion → Target Date → Department → Status

export type WorkStatus = 'completed' | 'in-progress' | 'delayed' | 'not-started'

export type SubHeadProgress = {
  name: string
  unit: WorkUnit
  details?: string[]
  required: number
  planned: number
  completed: number
  balance: number
  /** 0-1 */
  fraction: number
  /** Epoch ms. */
  targetDate: number
  department: string
  status: WorkStatus
  /** Only meaningful when completed work exists; completed items may still await verification. */
  verified: boolean
}

export type HeadProgress = {
  no: string
  name: string
  purpose: string
  subs: SubHeadProgress[]
  /** Mean of the sub-heads' fractions -- units differ, so quantities can't be summed. */
  fraction: number
  counts: Record<WorkStatus, number>
}

export type SectorWorkHeads = {
  heads: HeadProgress[]
  /** Mean of the heads' fractions. */
  fraction: number
  subHeadCount: number
  counts: Record<WorkStatus, number>
}

/** mulberry32 -- tiny seeded PRNG. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// [min, max, step] of a plausible sector-level requirement per unit.
const REQUIRED_RANGE: Record<WorkUnit, [number, number, number]> = {
  m: [800, 9000, 50],
  km: [2, 18, 0.5],
  'Sq. m.': [2000, 60000, 100],
  'Cu. m.': [1500, 30000, 100],
  'nos.': [4, 120, 1],
  KL: [20, 400, 5],
  KVA: [250, 3000, 50],
  poles: [30, 400, 1],
  persons: [20, 400, 5],
  'tonnes/day': [2, 40, 1],
  samples: [10, 120, 1],
  beds: [10, 200, 5],
  routes: [2, 12, 1],
}

const DAY_MS = 86_400_000

export function formatQuantity(value: number, unit: WorkUnit): string {
  const n = Number.isInteger(value) ? value.toLocaleString('en-IN') : value.toFixed(1)
  return `${n} ${unit}`
}

export function buildSectorWorkHeads(sectorNo: number, nowMs = Date.now()): SectorWorkHeads {
  // Day-aligned so every view built from the same instant agrees on what is overdue (a target
  // generated as exactly "today" must not flip between delayed and in-progress across callers).
  const now = Math.floor(nowMs / DAY_MS) * DAY_MS
  const emptyCounts = (): Record<WorkStatus, number> => ({
    completed: 0,
    'in-progress': 0,
    delayed: 0,
    'not-started': 0,
  })
  const total = emptyCounts()
  let subHeadCount = 0

  const heads: HeadProgress[] = WORK_HEADS.map((head, hi) => {
    // Each head gets its own overall pace in this sector so the 14 cards don't all look alike.
    const pace = 0.15 + rng(sectorNo * 7919 + hi * 104729)() * 0.8
    const counts = emptyCounts()

    const subs: SubHeadProgress[] = head.subs.map((sub, si) => {
      const r = rng(sectorNo * 100003 + hi * 1009 + si * 31 + 17)
      const [min, max, step] = REQUIRED_RANGE[sub.unit]
      const required = Math.max(step, Math.round((min + r() * (max - min)) / step) * step)

      // Mostly clustered around the head's pace; a few untouched and a few finished.
      const roll = r()
      let fraction: number
      if (roll < 0.1) fraction = 0
      else if (roll > 0.9) fraction = 1
      else fraction = Math.min(0.97, Math.max(0.04, pace + (r() - 0.5) * 0.6))

      const roundTo = (v: number) => Math.round(v / step) * step
      const completed = fraction >= 1 ? required : Math.min(required, roundTo(required * fraction))
      const planned = Math.min(
        required,
        Math.max(completed, roundTo(required * Math.min(1, fraction + 0.1 + r() * 0.25))),
      )
      const balance = Math.max(0, +(required - completed).toFixed(1))
      const actualFraction = required > 0 ? completed / required : 0

      // Targets run from late Sep 2026 (a few already passed) to mid-Jan 2027.
      const targetDate = now + (Math.round(r() * 120) - 12) * DAY_MS
      const department = head.depts[Math.floor(r() * head.depts.length)]

      let status: WorkStatus
      if (actualFraction >= 1) status = 'completed'
      else if (targetDate < now) status = 'delayed'
      else if (completed > 0) status = 'in-progress'
      else status = 'not-started'

      counts[status]++
      total[status]++
      subHeadCount++
      return {
        name: sub.name,
        unit: sub.unit,
        ...(sub.details ? { details: sub.details } : {}),
        required,
        planned,
        completed,
        balance,
        fraction: actualFraction,
        targetDate,
        department,
        status,
        verified: completed > 0 && r() > 0.35,
      }
    })

    return {
      no: head.no,
      name: head.name,
      purpose: head.purpose,
      subs,
      fraction: subs.reduce((sum, x) => sum + x.fraction, 0) / subs.length,
      counts,
    }
  })

  return {
    heads,
    fraction: heads.reduce((sum, h) => sum + h.fraction, 0) / heads.length,
    subHeadCount,
    counts: total,
  }
}
