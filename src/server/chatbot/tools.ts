import 'server-only'

import type { ChatVisual, SectorRef, StatusCounts } from '@/lib/chat/visuals'
import { buildSectorWorkHeads, formatQuantity } from '@/lib/workHeads/demo'
import { resolveSector, type SectorResolution } from '@/server/chatbot/sectors'
import { listTickets } from '@/server/services/ticket.service'

// The two tools the assistant may call. Both are read-only. `scope` carries the caller's ticket
// visibility (a Surveyor only ever sees tickets assigned to them), applied here rather than
// trusted from model-supplied arguments. Each tool returns `result` (JSON the model reads) and an
// optional `visual` (structured data the chat widget draws as KPI cards / lists).

export type ToolScope = { forcedAssigneeId?: string }

type Json = Record<string, unknown>
export type ToolOutput = { result: Json; visual?: ChatVisual }

export type ToolDeclaration = {
  name: string
  description: string
  parameters: Json
}

const SECTOR_DESC =
  'Sector number or name, e.g. 30, "Bairagicamp", "Laxman Jhula", "Har ki Paudi". Use the English ' +
  'spelling of the name.'

export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'get_work_progress',
    description:
      'Progress of Kumbh Mela work heads and sub-heads (site clearance, roads, electrical, water, ' +
      'tentage, sanitation, telecom, ISBT, fire, medical, police, signage, parking) in one sector: required, completed, balance, ' +
      'percent, target date, department and status. DEMO data. Shows KPI cards to the user.',
    parameters: {
      type: 'OBJECT',
      properties: {
        sector: { type: 'STRING', description: SECTOR_DESC },
        head: {
          type: 'STRING',
          description:
            'Optional English keyword matching a work head name, e.g. "road", "water", "electric". Omit for all heads.',
        },
      },
      required: ['sector'],
    },
  },
  {
    name: 'search_tickets',
    description:
      'Search real tickets (issues/tasks raised on the ground). Filter by sector, free text and ' +
      'status. Returns the newest matching tickets and the total count.',
    parameters: {
      type: 'OBJECT',
      properties: {
        sector: { type: 'STRING', description: `${SECTOR_DESC} Omit to search every sector.` },
        query: {
          type: 'STRING',
          description: 'Free-text keywords, e.g. "road", or a ticket number',
        },
        status: {
          type: 'STRING',
          description: 'One of: unresolved, new, open, pending, resolved. Default: unresolved.',
        },
        class_group: { type: 'STRING', description: 'Land-use class group, if the user named one' },
        limit: { type: 'INTEGER', description: 'Max tickets to return (1-10, default 5)' },
      },
    },
  },
]

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const pct = (f: number) => Math.round(f * 100)
const counts = (c: StatusCounts): StatusCounts => ({ ...c })

function asInt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isInteger(n) ? n : undefined
}

/** Turn an unresolved sector into an error the model can act on (ask / retry with a candidate). */
function sectorProblem(r: Exclude<SectorResolution, { kind: 'sector' }>): ToolOutput {
  if (r.kind === 'zone') {
    return {
      result: {
        error: `"${r.zone}" is a zone, not a sector. Ask which sector, or call the tool per sector.`,
        sectors_in_zone: r.sectors.map((s) => `${s.name} (no. ${s.no})`),
      },
    }
  }
  return {
    result: {
      error: 'Could not match that to a sector.',
      did_you_mean: r.candidates.map((s) => `${s.name} (no. ${s.no})`),
    },
  }
}

async function getWorkProgress(args: Json): Promise<ToolOutput> {
  const resolved = await resolveSector(args.sector ?? args.sector_no)
  if (resolved.kind !== 'sector') return sectorProblem(resolved)
  const sector: SectorRef = resolved.sector

  const keyword = typeof args.head === 'string' ? args.head.trim().toLowerCase() : ''
  const data = buildSectorWorkHeads(sector.no)
  const heads = data.heads.filter((h) => !keyword || h.name.toLowerCase().includes(keyword))
  if (heads.length === 0) {
    return {
      result: {
        error: `No work head matches "${keyword}"`,
        available_heads: data.heads.map((h) => h.name),
      },
    }
  }

  const focus = keyword && heads.length === 1 ? heads[0] : undefined
  const visual: ChatVisual = {
    type: 'progress',
    demo: true,
    sector,
    overallPercent: pct(data.fraction),
    counts: counts(data.counts),
    heads: data.heads.map((h) => ({
      no: h.no,
      name: h.name,
      percent: pct(h.fraction),
      counts: counts(h.counts),
    })),
    ...(focus
      ? {
          focus: {
            no: focus.no,
            name: focus.name,
            percent: pct(focus.fraction),
            counts: counts(focus.counts),
            subs: focus.subs.map((s) => ({
              name: s.name,
              status: s.status,
              percent: pct(s.fraction),
              completed: formatQuantity(s.completed, s.unit),
              required: formatQuantity(s.required, s.unit),
              balance: formatQuantity(s.balance, s.unit),
              targetDate: iso(s.targetDate),
              department: s.department,
            })),
          },
        }
      : {}),
  }

  return {
    visual,
    result: {
      demo_data: true,
      sector: { no: sector.no, name: sector.name, zone: sector.zone },
      sector_overall_percent: pct(data.fraction),
      // The cards already show every head, so the model only needs detail for the head(s) the
      // user asked about; a whole-sector question gets one summary line per head. This keeps the
      // reply small (the deployment has a tokens-per-minute quota).
      heads: heads.map((h) => ({
        head_no: h.no,
        name: h.name,
        percent_complete: pct(h.fraction),
        sub_heads_by_status: h.counts,
        ...(heads.length <= 2
          ? {
              sub_heads: h.subs.map((s) => ({
                name: s.name,
                status: s.status,
                completed: formatQuantity(s.completed, s.unit),
                required: formatQuantity(s.required, s.unit),
                percent_complete: pct(s.fraction),
                target_date: iso(s.targetDate),
                department: s.department,
              })),
            }
          : {
              delayed_sub_heads: h.subs
                .filter((s) => s.status === 'delayed')
                .map((s) => `${s.name} (${pct(s.fraction)}%, target ${iso(s.targetDate)})`),
            }),
      })),
    },
  }
}

type TicketRow = {
  number: number
  subject?: string
  statusId?: { name?: string } | null
  priorityId?: { name?: string } | null
  location?: { sectorNo?: number; classGroup?: string } | null
  lastActivityAt?: Date | string
}

async function searchTicketsTool(args: Json, scope: ToolScope): Promise<ToolOutput> {
  let sector: SectorRef | undefined
  const wanted = args.sector ?? args.sector_no
  if (wanted !== undefined && wanted !== null && String(wanted).trim() !== '') {
    const resolved = await resolveSector(wanted)
    if (resolved.kind !== 'sector') return sectorProblem(resolved)
    sector = resolved.sector
  }

  const limit = Math.min(10, Math.max(1, asInt(args.limit) ?? 5))
  const status = typeof args.status === 'string' && args.status ? args.status : 'unresolved'
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  const { items, total } = await listTickets({
    status,
    q: query || undefined,
    sectorNo: sector?.no,
    classGroup: typeof args.class_group === 'string' ? args.class_group : undefined,
    assigneeId: scope.forcedAssigneeId,
    pageSize: limit,
  })

  const tickets = (items as unknown as TicketRow[]).map((t) => ({
    number: t.number,
    subject: t.subject ?? '',
    status: t.statusId?.name ?? 'Unknown',
    priority: t.priorityId?.name ?? null,
    sector_no: t.location?.sectorNo ?? null,
    last_activity: t.lastActivityAt ? new Date(t.lastActivityAt).toISOString().slice(0, 10) : null,
  }))

  return {
    visual: {
      type: 'tickets',
      sector,
      total,
      statusFilter: status,
      tickets: tickets.map((t) => ({
        number: t.number,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        date: t.last_activity,
      })),
    },
    result: {
      sector: sector ? { no: sector.no, name: sector.name } : null,
      total_matching: total,
      status_filter: status,
      tickets,
    },
  }
}

export async function runTool(name: string, args: Json, scope: ToolScope): Promise<ToolOutput> {
  try {
    if (name === 'get_work_progress') return await getWorkProgress(args)
    if (name === 'search_tickets') return await searchTicketsTool(args, scope)
    return { result: { error: `Unknown tool ${name}` } }
  } catch (err) {
    console.error('[chat] tool failed', name, err)
    return { result: { error: 'The data source is unavailable right now' } }
  }
}
