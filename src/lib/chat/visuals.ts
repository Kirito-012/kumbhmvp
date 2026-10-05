import type { WorkStatus } from '@/lib/workHeads/demo'

// Structured data the chat tools return alongside the model's text, so the widget can draw KPI
// cards and bars instead of (or as well as) prose. Sent to the browser as plain JSON.

export type SectorRef = { no: number; name: string; zone: string | null }

export type StatusCounts = Record<WorkStatus, number>

export type SubHeadVisual = {
  name: string
  status: WorkStatus
  percent: number
  completed: string
  required: string
  balance: string
  targetDate: string
  department: string
}

export type ProgressVisual = {
  type: 'progress'
  /** Work-progress figures are demo data until a real store exists. */
  demo: true
  sector: SectorRef
  overallPercent: number
  counts: StatusCounts
  heads: { no: string; name: string; percent: number; counts: StatusCounts }[]
  /** Set when the question was about one head (e.g. roads): its sub-heads in detail. */
  focus?: { no: string; name: string; percent: number; counts: StatusCounts; subs: SubHeadVisual[] }
}

export type TicketsVisual = {
  type: 'tickets'
  sector?: SectorRef
  total: number
  statusFilter: string
  tickets: {
    number: number
    subject: string
    status: string
    priority: string | null
    date: string | null
  }[]
}

export type ChatVisual = ProgressVisual | TicketsVisual
