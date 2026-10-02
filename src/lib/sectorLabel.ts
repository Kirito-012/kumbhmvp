/** `kumbh.sector_boundary.name` is stored shouting and suffixed with the sector number it already
 *  carries as its own column ("BAHADRABAD-01", "MUNNI-KI-RETI-25"). Shown raw next to a sector
 *  number it reads as a duplicate, and in capitals it is noticeably harder to scan — so UI that
 *  wants a friendly label goes through here. Falls back to "Sector N" when there is no name. */
export function formatSectorName(name: string | null | undefined, sectorNo: number): string {
  if (!name) return `Sector ${sectorNo}`
  const base = name
    .replace(/-\d+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase())
  return base || `Sector ${sectorNo}`
}

/** "RANIPUR ZONE" -> "Ranipur zone". */
export function formatZoneName(zone: string | null | undefined): string | null {
  const words = (zone ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  return words
    .map((w, i) => (i > 0 && w === 'zone' ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}
