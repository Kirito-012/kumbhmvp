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
]

export type InsightsTicketData = {
  generatedAt: string
  statuses: InsightsStatusRow[]
  priorities: InsightsPriorityRow[]
  classGroups: string[]
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
}
