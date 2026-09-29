import { describe, expect, it } from 'vitest'
import { bucketForStatus, isOpenBucket } from './statusBuckets'

describe('bucketForStatus', () => {
  it('maps each of the 4 seeded slugs to its own bucket', () => {
    expect(bucketForStatus({ slug: 'new', isResolved: false })).toBe('new')
    expect(bucketForStatus({ slug: 'open', isResolved: false })).toBe('open')
    expect(bucketForStatus({ slug: 'pending', isResolved: false })).toBe('pending')
    expect(bucketForStatus({ slug: 'resolved', isResolved: true })).toBe('resolved')
  })

  it('falls back to isResolved for an unknown slug', () => {
    expect(bucketForStatus({ slug: 'triaged', isResolved: false })).toBe('open')
    expect(bucketForStatus({ slug: 'archived', isResolved: true })).toBe('resolved')
  })
})

describe('isOpenBucket', () => {
  it('treats new, open and pending as open', () => {
    expect(isOpenBucket('new')).toBe(true)
    expect(isOpenBucket('open')).toBe(true)
    expect(isOpenBucket('pending')).toBe(true)
  })

  it('treats resolved as not open', () => {
    expect(isOpenBucket('resolved')).toBe(false)
  })
})
