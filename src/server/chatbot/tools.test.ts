import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { listTickets } = vi.hoisted(() => ({ listTickets: vi.fn() }))
vi.mock('@/server/services/ticket.service', () => ({ listTickets }))

// The real list lives in Postgres (kumbh.sector_boundary); a few real rows are enough here.
const SECTORS = [
  { sector_no: 11, name: 'BAIRAGICAMP-11', zone: 'BAIRAGICAMP ZONE' },
  { sector_no: 12, name: 'SATIDWEEP-12', zone: 'BAIRAGICAMP ZONE' },
  { sector_no: 22, name: 'HARKIPAUDI-22', zone: 'PANTDWEEP ZONE' },
  { sector_no: 25, name: 'MUNNI-KI-RETI-25', zone: 'RISHIKESH ZONE' },
  { sector_no: 30, name: 'LAXMANJHULA-30', zone: 'RISHIKESH ZONE' },
]
vi.mock('@/server/db/postgres', () => ({
  getPool: () => ({ query: async () => ({ rows: SECTORS }) }),
}))

import { runTool } from './tools'

describe('chatbot tools', () => {
  it('returns demo progress plus a KPI visual, focused on the head asked for', async () => {
    const { result, visual } = await runTool(
      'get_work_progress',
      { sector: '30', head: 'road' },
      {},
    )
    expect(result.demo_data).toBe(true)
    expect((result.heads as { name: string }[])[0].name).toMatch(/Road/)
    expect(visual?.type).toBe('progress')
    if (visual?.type === 'progress') {
      expect(visual.sector.name).toBe('LAXMANJHULA-30')
      expect(visual.focus?.subs.length).toBeGreaterThan(0)
    }
  })

  it.each(['Bairagicamp', 'bairagi camp', 'Bairagi Camp', 'sector 11', '11', 'Bairagicmp'])(
    'resolves %s to sector 11',
    async (name) => {
      const { result } = await runTool('get_work_progress', { sector: name }, {})
      expect((result.sector as { no: number }).no).toBe(11)
    },
  )

  it('handles hyphenated and spaced names', async () => {
    const { result } = await runTool('get_work_progress', { sector: 'Munni ki Reti' }, {})
    expect((result.sector as { no: number }).no).toBe(25)
  })

  it('explains a zone instead of guessing, and suggests names for unknowns', async () => {
    const zone = await runTool('get_work_progress', { sector: 'Rishikesh zone' }, {})
    expect(zone.result).toHaveProperty('sectors_in_zone')
    const unknown = await runTool('get_work_progress', { sector: 'Atlantis' }, {})
    expect(unknown.result).toHaveProperty('error')
  })

  it('rejects an unknown head with the available ones', async () => {
    const { result } = await runTool('get_work_progress', { sector: 30, head: 'zzz' }, {})
    expect(result).toHaveProperty('available_heads')
  })

  it('applies the caller scope to ticket searches, not model arguments', async () => {
    listTickets.mockResolvedValue({ items: [], total: 0 })
    await runTool(
      'search_tickets',
      { sector: 'Harkipaudi', assigneeId: 'someone-else' },
      { forcedAssigneeId: 'u1' },
    )
    expect(listTickets).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: 'u1', sectorNo: 22, status: 'unresolved' }),
    )
  })
})
