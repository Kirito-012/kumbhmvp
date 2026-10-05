import { getCurrentUser } from '@/server/auth/session'
import { defineAbilityFor } from '@/server/auth/ability'
import { answer, ChatBusyError, ChatConfigError, type ChatTurn } from '@/server/chatbot/llm'

export const runtime = 'nodejs'

const MAX_TURNS = 10
const MAX_CHARS = 1000

/** Session-authenticated chat endpoint. Body: { messages: [{ role, text }] }. Ticket visibility
 *  follows the same Surveyor scoping as the Tickets page. */
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { messages?: unknown } | null
  const raw: unknown[] = Array.isArray(body?.messages) ? body.messages : []
  const history: ChatTurn[] = raw
    .filter(
      (m): m is ChatTurn =>
        !!m &&
        typeof m === 'object' &&
        ((m as ChatTurn).role === 'user' || (m as ChatTurn).role === 'assistant') &&
        typeof (m as ChatTurn).text === 'string' &&
        (m as ChatTurn).text.trim().length > 0,
    )
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, text: m.text.slice(0, MAX_CHARS) }))

  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return Response.json({ error: 'Send a user message' }, { status: 400 })
  }

  const ability = defineAbilityFor(user.grants)
  const forcedAssigneeId = ability.can('read:all', 'ticket') ? undefined : user.id

  try {
    const { reply, visuals } = await answer(history, { forcedAssigneeId })
    return Response.json({ reply, visuals })
  } catch (err) {
    if (err instanceof ChatConfigError) {
      return Response.json({ error: 'Assistant is not configured yet.' }, { status: 503 })
    }
    if (err instanceof ChatBusyError) {
      return Response.json(
        { error: 'The assistant is busy right now. Please try again in a minute.' },
        { status: 429 },
      )
    }
    console.error('[chat] failed', err)
    return Response.json(
      { error: 'The assistant could not answer. Please try again.' },
      { status: 502 },
    )
  }
}
