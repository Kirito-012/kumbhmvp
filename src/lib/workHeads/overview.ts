import { buildSectorWorkHeads, type HeadProgress, type WorkStatus } from '@/lib/workHeads/demo'

// DEMO DATA, rolled up across sectors for the dashboard. Each sector's figures come from
// `buildSectorWorkHeads` (deterministic, see demo.ts); swap that for the real per-sector fetch and
// this roll-up keeps working unchanged.

export type HeadOverview = {
  no: string
  name: string
  /** 0-1, mean of this head's completion across the sectors. */
  fraction: number
  /** Sub-head tasks by status, summed over every sector. */
  counts: Record<WorkStatus, number>
  total: number
  /** How many sectors have at least one delayed sub-head under this head. */
  delayedSectors: number
}

export type WorkHeadsOverview = {
  sectorCount: number
  /** 0-1, mean of the heads' completion. */
  fraction: number
  counts: Record<WorkStatus, number>
  total: number
  heads: HeadOverview[]
}

export function buildWorkHeadsOverview(sectorNos: number[]): WorkHeadsOverview {
  const empty = (): Record<WorkStatus, number> => ({
    completed: 0,
    'in-progress': 0,
    delayed: 0,
    'not-started': 0,
  })
  const counts = empty()
  const nowMs = Date.now()
  const perSector = sectorNos.map((n) => buildSectorWorkHeads(n, nowMs))

  const heads: HeadOverview[] = (perSector[0]?.heads ?? []).map((first: HeadProgress, hi) => {
    const c = empty()
    let sum = 0
    let delayedSectors = 0
    for (const s of perSector) {
      const h = s.heads[hi]
      sum += h.fraction
      if (h.counts.delayed > 0) delayedSectors++
      for (const k of Object.keys(c) as WorkStatus[]) c[k] += h.counts[k]
    }
    for (const k of Object.keys(c) as WorkStatus[]) counts[k] += c[k]
    return {
      no: first.no,
      name: first.name,
      fraction: sum / perSector.length,
      counts: c,
      total: Object.values(c).reduce((a, b) => a + b, 0),
      delayedSectors,
    }
  })

  return {
    sectorCount: sectorNos.length,
    fraction: heads.length ? heads.reduce((a, h) => a + h.fraction, 0) / heads.length : 0,
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    heads,
  }
}
