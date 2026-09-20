import { describe, it, expect } from 'vitest'
import {
  rollupBySector,
  heatValueForSector,
  isOpenTicket,
  matchesFilters,
  bucketBySectorPlanId,
} from './aggregate'
import type { InsightsStatusRow, InsightsTicketTuple } from './types'

const statuses: InsightsStatusRow[] = [
  { slug: 'new', name: 'New', bucket: 'new', color: '#1d6fe0' },
  { slug: 'in-progress', name: 'In progress', bucket: 'progress', color: '#d97706' },
  { slug: 'resolved', name: 'Resolved', bucket: 'resolved', color: '#16a34a' },
  { slug: 'closed', name: 'Closed', bucket: 'closed', color: '#dc2626' },
]
const priorities = [
  { slug: 'low', name: 'Low', color: '#94a3b8', order: 0 },
  { slug: 'normal', name: 'Normal', color: '#3b82f6', order: 1 },
  { slug: 'high', name: 'High', color: '#f59e0b', order: 2 },
  { slug: 'critical', name: 'Critical', color: '#dc2626', order: 3 },
]
const classGroups = ['Residential', 'Commercial']

const NOW = 1_700_000_000_000

function ticket(
  overrides: Partial<{
    number: number
    sectorPlanId: number
    sectorNo: number | null
    statusIdx: number
    priorityIdx: number
    classGroupIdx: number
    lng: number
    lat: number
    createdAt: number
    resolvedAt: number | null
    subclassIdx: number
  }>,
): InsightsTicketTuple {
  const t = {
    number: 1,
    sectorPlanId: 1,
    sectorNo: 7,
    statusIdx: 0,
    priorityIdx: 1,
    classGroupIdx: 0,
    lng: 0,
    lat: 0,
    createdAt: NOW,
    resolvedAt: null,
    subclassIdx: -1,
    ...overrides,
  }
  return [
    t.number,
    t.sectorPlanId,
    t.sectorNo,
    t.statusIdx,
    t.priorityIdx,
    t.classGroupIdx,
    t.lng,
    t.lat,
    t.createdAt,
    t.resolvedAt,
    t.subclassIdx,
  ]
}

describe('isOpenTicket', () => {
  it('treats new/progress as open and resolved/closed as not open', () => {
    expect(isOpenTicket(ticket({ statusIdx: 0 }), statuses)).toBe(true)
    expect(isOpenTicket(ticket({ statusIdx: 1 }), statuses)).toBe(true)
    expect(isOpenTicket(ticket({ statusIdx: 2 }), statuses)).toBe(false)
    expect(isOpenTicket(ticket({ statusIdx: 3 }), statuses)).toBe(false)
  })

  it('treats an out-of-range status index as not open', () => {
    expect(isOpenTicket(ticket({ statusIdx: 99 }), statuses)).toBe(false)
  })
})

describe('matchesFilters', () => {
  const t = ticket({ statusIdx: 0, priorityIdx: 2, classGroupIdx: 1, createdAt: NOW })

  it('passes with no filters', () => {
    expect(matchesFilters(t, statuses, priorities, classGroups, {}, NOW)).toBe(true)
  })

  it('filters by status slug', () => {
    expect(
      matchesFilters(t, statuses, priorities, classGroups, { statusSlugs: ['new'] }, NOW),
    ).toBe(true)
    expect(
      matchesFilters(t, statuses, priorities, classGroups, { statusSlugs: ['closed'] }, NOW),
    ).toBe(false)
  })

  it('filters by priority slug', () => {
    expect(
      matchesFilters(t, statuses, priorities, classGroups, { prioritySlugs: ['high'] }, NOW),
    ).toBe(true)
    expect(
      matchesFilters(t, statuses, priorities, classGroups, { prioritySlugs: ['low'] }, NOW),
    ).toBe(false)
  })

  it('filters by class group', () => {
    expect(
      matchesFilters(t, statuses, priorities, classGroups, { classGroups: ['Commercial'] }, NOW),
    ).toBe(true)
    expect(
      matchesFilters(t, statuses, priorities, classGroups, { classGroups: ['Residential'] }, NOW),
    ).toBe(false)
  })

  it('filters by createdWithinMs', () => {
    const oldTicket = ticket({ createdAt: NOW - 10_000 })
    expect(
      matchesFilters(oldTicket, statuses, priorities, classGroups, { createdWithinMs: 5_000 }, NOW),
    ).toBe(false)
    expect(
      matchesFilters(
        oldTicket,
        statuses,
        priorities,
        classGroups,
        { createdWithinMs: 20_000 },
        NOW,
      ),
    ).toBe(true)
  })

  it('combines every filter with AND semantics', () => {
    expect(
      matchesFilters(
        t,
        statuses,
        priorities,
        classGroups,
        { statusSlugs: ['new'], prioritySlugs: ['high'], classGroups: ['Commercial'] },
        NOW,
      ),
    ).toBe(true)
    expect(
      matchesFilters(
        t,
        statuses,
        priorities,
        classGroups,
        { statusSlugs: ['new'], prioritySlugs: ['low'], classGroups: ['Commercial'] },
        NOW,
      ),
    ).toBe(false)
  })
})

describe('rollupBySector', () => {
  it('groups by sector and buckets by status', () => {
    const tickets = [
      ticket({ sectorNo: 7, statusIdx: 0 }), // new
      ticket({ sectorNo: 7, statusIdx: 1 }), // progress
      ticket({ sectorNo: 7, statusIdx: 2 }), // resolved
      ticket({ sectorNo: 5, statusIdx: 3 }), // closed
    ]
    const rollups = rollupBySector(tickets, statuses, priorities, classGroups)
    const sector7 = rollups.get(7)!
    expect(sector7.total).toBe(3)
    expect(sector7.open).toBe(2)
    expect(sector7.newCount).toBe(1)
    expect(sector7.progressCount).toBe(1)
    expect(sector7.resolved).toBe(1)

    const sector5 = rollups.get(5)!
    expect(sector5.total).toBe(1)
    expect(sector5.closed).toBe(1)
    expect(sector5.open).toBe(0)
  })

  it('groups peripheral tickets (sectorNo null) under the null key', () => {
    const tickets = [ticket({ sectorNo: null, statusIdx: 0 })]
    const rollups = rollupBySector(tickets, statuses, priorities, classGroups)
    expect(rollups.get(null)?.total).toBe(1)
  })

  it('excludes tickets that fail the filter from every bucket', () => {
    const tickets = [
      ticket({ sectorNo: 7, priorityIdx: 1 }), // normal -- filtered out below
      ticket({ sectorNo: 7, priorityIdx: 3 }), // critical -- kept
    ]
    const rollups = rollupBySector(tickets, statuses, priorities, classGroups, {
      prioritySlugs: ['critical'],
    })
    expect(rollups.get(7)?.total).toBe(1)
  })

  it('returns an empty map for an empty ticket list', () => {
    expect(rollupBySector([], statuses, priorities, classGroups).size).toBe(0)
  })
})

describe('heatValueForSector', () => {
  const rollup = {
    sectorNo: 7,
    total: 10,
    open: 4,
    resolved: 5,
    closed: 1,
    newCount: 2,
    progressCount: 2,
  }

  it('returns 0 for an undefined rollup or zero-total rollup', () => {
    expect(heatValueForSector(undefined, 'total')).toBe(0)
    expect(heatValueForSector({ ...rollup, total: 0 }, 'total')).toBe(0)
  })

  it('computes each metric correctly', () => {
    expect(heatValueForSector(rollup, 'total')).toBe(10)
    expect(heatValueForSector(rollup, 'pctOpen')).toBe(40)
  })
})

describe('bucketBySectorPlanId', () => {
  it('maps each sectorPlanId to its status bucket with no filters', () => {
    const tickets = [
      ticket({ sectorPlanId: 1, statusIdx: 0 }), // new
      ticket({ sectorPlanId: 2, statusIdx: 2 }), // resolved
    ]
    const buckets = bucketBySectorPlanId(tickets, statuses, priorities, classGroups)
    expect(buckets.get(1)).toBe('new')
    expect(buckets.get(2)).toBe('resolved')
  })

  it('mutes a parcel whose ticket fails the active filters, rather than omitting it', () => {
    const tickets = [
      ticket({ sectorPlanId: 1, priorityIdx: 1 }), // normal -- filtered out below
      ticket({ sectorPlanId: 2, priorityIdx: 3 }), // critical -- kept
    ]
    const buckets = bucketBySectorPlanId(tickets, statuses, priorities, classGroups, {
      prioritySlugs: ['critical'],
    })
    expect(buckets.get(1)).toBe('muted')
    expect(buckets.get(2)).toBe('new')
  })

  it('mutes a parcel whose status index is out of range', () => {
    const tickets = [ticket({ sectorPlanId: 3, statusIdx: 99 })]
    const buckets = bucketBySectorPlanId(tickets, statuses, priorities, classGroups)
    expect(buckets.get(3)).toBe('muted')
  })

  it('returns an empty map for an empty ticket list', () => {
    expect(bucketBySectorPlanId([], statuses, priorities, classGroups).size).toBe(0)
  })
})
