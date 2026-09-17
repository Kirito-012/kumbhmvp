import { describe, expect, it } from 'vitest'
import { bucketForStatus, isOpenBucket } from './statusBuckets'

describe('bucketForStatus', () => {
  it('maps the 5 seeded slugs to their bucket', () => {
    expect(bucketForStatus({ slug: 'new', isResolved: false })).toBe('new')
    expect(bucketForStatus({ slug: 'open', isResolved: false })).toBe('progress')
    expect(bucketForStatus({ slug: 'pending', isResolved: false })).toBe('progress')
    expect(bucketForStatus({ slug: 'resolved', isResolved: true })).toBe('resolved')
    expect(bucketForStatus({ slug: 'closed', isResolved: true })).toBe('closed')
  })

  it('falls back to isResolved for an unknown slug', () => {
    expect(bucketForStatus({ slug: 'triaged', isResolved: false })).toBe('progress')
    expect(bucketForStatus({ slug: 'archived', isResolved: true })).toBe('resolved')
  })
})

describe('isOpenBucket', () => {
  it('treats new and progress as open', () => {
    expect(isOpenBucket('new')).toBe(true)
    expect(isOpenBucket('progress')).toBe(true)
  })

  it('treats resolved and closed as not open', () => {
    expect(isOpenBucket('resolved')).toBe(false)
    expect(isOpenBucket('closed')).toBe(false)
  })
})
