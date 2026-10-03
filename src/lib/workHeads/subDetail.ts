import type { SubHeadProgress } from '@/lib/workHeads/demo'

// DEMO DATA for the sub-head detail view: a progress trend and a few related tickets. Like
// demo.ts, everything is derived deterministically from the sub-head itself (same sub-head, same
// numbers), and every place it appears is labelled "Demo".

const DAY_MS = 86_400_000

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

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

export type TrendPoint = {
  /** Epoch ms (day-aligned). */
  t: number
  /** Cumulative quantity the plan wants done by then. */
  planned: number
  /** Cumulative quantity actually done; null for dates still in the future. */
  actual: number | null
}

/** Cumulative planned vs actual quantity, one point every 10 days from 150 days before the target
 *  to 30 days after it. The plan climbs steadily to `required`; the actual line climbs unevenly
 *  and ends at `completed` today. */
export function buildSubHeadTrend(seed: string, sub: SubHeadProgress, now: number): TrendPoint[] {
  const r = rng(hash(seed))
  const start = sub.targetDate - 150 * DAY_MS
  const end = sub.targetDate + 30 * DAY_MS
  const steps = Math.round((end - start) / (10 * DAY_MS))

  const points: TrendPoint[] = []
  let lastActual = 0
  for (let i = 0; i <= steps; i++) {
    const t = start + i * 10 * DAY_MS
    const planned = Math.min(1, Math.max(0, (t - start) / (sub.targetDate - start))) * sub.required
    let actual: number | null = null
    if (t <= now) {
      // Share of the way to "today": eased so work picks up after a slow start, plus some wobble,
      // never decreasing, and landing exactly on `completed` at the last past point.
      const span = Math.max(1, now - start)
      const p = Math.min(1, (t - start) / span)
      const eased = Math.pow(p, 1.35)
      lastActual = Math.max(lastActual, sub.completed * Math.min(1, eased + (r() - 0.5) * 0.08))
      actual = lastActual
    }
    points.push({ t, planned, actual })
  }
  // Pin the last past point to the true completed figure so the chart agrees with the numbers.
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].actual !== null) {
      points[i].actual = sub.completed
      break
    }
  }
  return points
}

export type DemoTicket = {
  id: string
  title: string
  status: 'Open' | 'In progress' | 'Resolved'
  updated: string
}

const TICKET_TITLES = [
  'Material delivery delayed',
  'Inspection pending',
  'Contractor query on specification',
  'Site access blocked',
  'Quantity mismatch reported',
  'Work completed, awaiting sign-off',
  'Safety observation raised',
]
const UPDATED = ['2 hrs ago', '5 hrs ago', 'Yesterday', '2 days ago', '4 days ago']
const TICKET_STATUS: DemoTicket['status'][] = ['Open', 'In progress', 'Resolved']

export function buildSubHeadTickets(seed: string, count = 4): DemoTicket[] {
  const r = rng(hash(`${seed}:tickets`))
  const base = 100 + Math.floor(r() * 800)
  return Array.from({ length: count }, (_, i) => ({
    id: `E-${String(base + i * 7).padStart(3, '0')}`,
    title: TICKET_TITLES[Math.floor(r() * TICKET_TITLES.length)],
    status: TICKET_STATUS[Math.floor(r() * TICKET_STATUS.length)],
    updated: UPDATED[Math.min(i, UPDATED.length - 1)],
  }))
}
