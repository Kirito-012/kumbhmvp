// Maps the 4 seeded ticket statuses (new/open/pending/resolved — see scripts/seed.ts) to the
// buckets Heatmap/Ticket mode colour by — one bucket per status, each with its own colour. Matching
// is by slug first, falling back to `isResolved` for any status an admin adds later that isn't one
// of the four known slugs — this is the same "don't hardcode against a list that can grow" concern
// getDashboardData's resolvedIds lookup already handles by querying isResolved rather than a slug
// enum. (A fifth 'closed' status existed until scripts/migrate-remove-closed-status.ts retired it.)
export type StatusBucket = 'new' | 'open' | 'pending' | 'resolved'

const SLUG_TO_BUCKET: Record<string, StatusBucket> = {
  new: 'new',
  open: 'open',
  pending: 'pending',
  resolved: 'resolved',
}

export function bucketForStatus(status: { slug: string; isResolved: boolean }): StatusBucket {
  return SLUG_TO_BUCKET[status.slug] ?? (status.isResolved ? 'resolved' : 'open')
}

/** "Open" for the Heatmap metric = anything not yet resolved (new, open or pending), matching
 *  getDashboardData's openMatch (statusId $nin resolvedIds) semantics but at the bucket level. */
export function isOpenBucket(bucket: StatusBucket): boolean {
  return bucket !== 'resolved'
}

export const BUCKET_ORDER: StatusBucket[] = ['new', 'open', 'pending', 'resolved']

export const BUCKET_LABELS: Record<StatusBucket, string> = {
  new: 'New',
  open: 'Open',
  pending: 'Pending',
  resolved: 'Resolved',
}

/** Four distinct hue families (blue / amber / violet / green) so neighbouring parcels in Ticket
 *  mode never read as the same status. The dark values match each status's own seeded `color`
 *  (scripts/seed.ts), which is what ticket badges and popups use. */
export const BUCKET_COLORS: Record<StatusBucket, { light: string; dark: string }> = {
  new: { light: '#1d6fe0', dark: '#38a3ff' },
  open: { light: '#ca8a04', dark: '#ffc933' },
  pending: { light: '#7c3aed', dark: '#a78bfa' },
  resolved: { light: '#16a34a', dark: '#22c55e' },
}
