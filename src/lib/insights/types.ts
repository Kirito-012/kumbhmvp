import type { StatusBucket } from './statusBuckets'

// Shared with the server (insights.service.ts) AND the client (aggregate.ts, useTicketInsights,
// insightLayers.ts) -- kept in a plain lib module with no 'server-only'/'use client' markers so
// both sides import the same type identities instead of two structurally-identical copies
// drifting apart.

/** One row per status/priority the client indexes into by position -- see InsightsTicketTuple. */
export type InsightsStatusRow = { slug: string; name: string; bucket: StatusBucket; color: string }
export type InsightsPriorityRow = { slug: string; name: string; color: string; order: number }

export type InsightsTicketTuple = [
  number, // ticket number
  number, // location.sectorPlanId
  number | null, // location.sectorNo
  number, // index into `statuses`
  number, // index into `priorities`
  number, // index into `classGroups`
  number, // location.lng
  number, // location.lat
  number, // createdAt (ms since epoch)
  number | null, // resolvedAt (ms since epoch), null if still unresolved
  number, // index into `subclasses`, or -1 if location.subclass is null
]

export type InsightsTicketData = {
  generatedAt: string
  statuses: InsightsStatusRow[]
  priorities: InsightsPriorityRow[]
  classGroups: string[]
  subclasses: string[]
  tickets: InsightsTicketTuple[]
}

// Named indices into InsightsTicketTuple -- clearer than a bare tuple[3] at call sites.
export const enum TicketField {
  Number = 0,
  SectorPlanId = 1,
  SectorNo = 2,
  StatusIdx = 3,
  PriorityIdx = 4,
  ClassGroupIdx = 5,
  Lng = 6,
  Lat = 7,
  CreatedAt = 8,
  ResolvedAt = 9,
  SubclassIdx = 10,
}

// Per-sector Insights panel detail (Phase 5) -- shapes returned by getSectorInsights and consumed
// by useSectorInsights.ts. Kept here rather than in insights.service.ts (a 'server-only' module)
// for the same reason as the tuple types above: useSectorInsights.ts is a client hook and needs
// the same type identity, not a structurally-identical copy.
export type SectorTrendDay = { day: string; created: number; resolved: number }
export type SectorAssignee = { id: string; name: string; open: number }
export type SectorTicketRow = {
  number: number
  subject: string
  statusSlug: string
  prioritySlug: string
  classGroup: string
  subclass: string | null
  sectorPlanId: number
  lng: number
  lat: number
  lastActivityAt: string
}

export type SectorInsights = {
  // null covers both the "peripheral" bucket and the unfiltered all-sectors overview -- callers
  // already know which of the two they asked for, so the response doesn't need to disambiguate.
  sectorNo: number | null
  totalCount: number
  trend7d: SectorTrendDay[]
  assignees: SectorAssignee[]
  oldestOpen: { number: number; subject: string; ageDays: number } | null
  medianResolveHours: number | null
  tickets: SectorTicketRow[]
  truncated: boolean
}
