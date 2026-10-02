// DEMO DATA. There is no encroachment survey in the database yet, so the Sector Report shows a
// stand-in figure per sector. It is deterministic (the same sector always gets the same number, so
// the drawer doesn't flicker between visits) and every place it appears is labelled "Demo".
// Replace `demoEncroachedHectares` with a real query/column when the survey data is available.

/** Small seeded PRNG (mulberry32) — enough to spread values across sectors. */
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Hectares of Mela land the sector is (pretend) encroached on: none in roughly one sector in six,
 *  otherwise 3-14% of the sector's utilized Mela land, to two decimals. */
export function demoEncroachedHectares(sectorNo: number, melaLandHectares: number): number {
  const rand = seeded(sectorNo * 2654435761)
  if (melaLandHectares <= 0 || rand() < 1 / 6) return 0
  const share = 0.03 + rand() * 0.11
  return Math.round(melaLandHectares * share * 100) / 100
}
