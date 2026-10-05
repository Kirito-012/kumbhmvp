import 'server-only'

import type { SectorRef } from '@/lib/chat/visuals'

// Sector names live in Postgres (`kumbh.sector_boundary`, 32 static rows named like
// "BAIRAGICAMP-11"). Users say "Bairagi camp", "sector 11" or "11", so the chat tools accept free
// text and resolve it here, tolerating spacing, case and small typos.

let cache: { at: number; sectors: SectorRef[] } | undefined
const TTL_MS = 10 * 60_000

export async function getSectors(): Promise<SectorRef[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.sectors
  try {
    const { getPool } = await import('@/server/db/postgres')
    const { rows } = await getPool().query<{
      sector_no: number
      name: string
      zone: string | null
    }>('SELECT sector_no, name, zone FROM kumbh.sector_boundary ORDER BY sector_no')
    const sectors = rows.map((r) => ({
      no: Number(r.sector_no),
      name: r.name,
      zone: r.zone ?? null,
    }))
    cache = { at: Date.now(), sectors }
    return sectors
  } catch (err) {
    console.error('[chat] sector lookup failed', err)
    return cache?.sectors ?? []
  }
}

/** Lower-case letters and digits only: "Bairagi Camp" -> "bairagicamp". */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
/** "BAIRAGICAMP-11" -> "bairagicamp"; "MUNNI-KI-RETI-25" -> "munnikireti". */
const baseName = (s: string) => squash(s.replace(/-\d+$/, ''))
const zoneKey = (z: string) => squash(z.replace(/\s*zone\s*$/i, ''))

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return dp[a.length][b.length]
}

export type SectorResolution =
  | { kind: 'sector'; sector: SectorRef }
  | { kind: 'zone'; zone: string; sectors: SectorRef[] }
  | { kind: 'none'; candidates: SectorRef[] }

/** Resolve a sector number or name ("30", "sector 30", "Laxman Jhula", "bairagicamp"). */
export async function resolveSector(input: unknown): Promise<SectorResolution> {
  const sectors = await getSectors()
  const raw = String(input ?? '').trim()

  // A bare number, or "sector 30" / "sector no. 30".
  const num = raw.match(/^(?:sector\s*(?:no\.?|number)?\s*)?(\d{1,3})$/i)
  if (num) {
    const hit = sectors.find((s) => s.no === Number(num[1]))
    if (hit) return { kind: 'sector', sector: hit }
    // Postgres unreachable (empty list): trust the number rather than fail the question.
    if (sectors.length === 0) {
      return {
        kind: 'sector',
        sector: { no: Number(num[1]), name: `Sector ${num[1]}`, zone: null },
      }
    }
    return { kind: 'none', candidates: [] }
  }

  // "Rishikesh zone" means the zone, not the sector of the same name.
  const wantsZone = /\bzone\b/i.test(raw)
  const q = squash(raw.replace(/\b(sector|zone)\b/gi, ''))
  if (!q) return { kind: 'none', candidates: sectors.slice(0, 8) }
  if (wantsZone) {
    const inZone = sectors.filter((s) => s.zone && zoneKey(s.zone) === q)
    if (inZone.length > 0) return { kind: 'zone', zone: inZone[0].zone!, sectors: inZone }
  }

  const exact = sectors.find((s) => baseName(s.name) === q)
  if (exact) return { kind: 'sector', sector: exact }

  const partial = sectors.filter((s) => q.length >= 4 && baseName(s.name).includes(q))
  if (partial.length === 1) return { kind: 'sector', sector: partial[0] }
  if (partial.length > 1) return { kind: 'none', candidates: partial }

  // Small typos / spelling variants (Laxman jhula vs Laxmanjhula, Haridwar vs Hardwar).
  const scored = sectors
    .map((s) => ({ s, d: distance(q, baseName(s.name)) }))
    .sort((a, b) => a.d - b.d)
  const best = scored[0]
  const tolerance = q.length >= 8 ? 2 : 1
  if (best && best.d <= tolerance && (scored[1]?.d ?? 99) > best.d) {
    return { kind: 'sector', sector: best.s }
  }

  const zoneHit = sectors.filter((s) => s.zone && zoneKey(s.zone) === q)
  if (zoneHit.length > 0) return { kind: 'zone', zone: zoneHit[0].zone!, sectors: zoneHit }

  return { kind: 'none', candidates: scored.slice(0, 5).map((x) => x.s) }
}
