// Collapses the 5 seeded ticket statuses (new/open/pending/resolved/closed — see scripts/seed.ts)
// down to the 4 buckets Heatmap/Ticket mode actually colour by. Matching is by slug first
// (so New gets its own blue rather than folding into "progress" with Open/Pending), falling back
// to `isResolved` for any status an admin adds later that isn't one of the five known slugs —
// this is the same "don't hardcode against a list that can grow" concern getDashboardData's
// resolvedIds lookup already handles by querying isResolved rather than a slug enum.
export type StatusBucket = 'new' | 'progress' | 'resolved' | 'closed'

const SLUG_TO_BUCKET: Record<string, StatusBucket> = {
  new: 'new',
  open: 'progress',
  pending: 'progress',
  resolved: 'resolved',
  closed: 'closed',
}

export function bucketForStatus(status: { slug: string; isResolved: boolean }): StatusBucket {
  return SLUG_TO_BUCKET[status.slug] ?? (status.isResolved ? 'resolved' : 'progress')
}

/** "Open" for the Heatmap metric = not resolved and not closed, matching getDashboardData's
 *  openMatch (statusId $nin resolvedIds) semantics but at the bucket level. */
export function isOpenBucket(bucket: StatusBucket): boolean {
  return bucket !== 'resolved' && bucket !== 'closed'
}

export const BUCKET_ORDER: StatusBucket[] = ['new', 'progress', 'resolved', 'closed']

export const BUCKET_LABELS: Record<StatusBucket, string> = {
  new: 'New',
  progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

export const BUCKET_COLORS: Record<StatusBucket, { light: string; dark: string }> = {
  new: { light: '#1d6fe0', dark: '#38a3ff' },
  progress: { light: '#ca8a04', dark: '#ffc933' },
  resolved: { light: '#16a34a', dark: '#22c55e' },
  closed: { light: '#dc2626', dark: '#ff5a5f' },
}
