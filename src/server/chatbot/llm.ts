import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChatVisual } from '@/lib/chat/visuals'
import { runTool, TOOL_DECLARATIONS, type ToolScope } from '@/server/chatbot/tools'

// Azure OpenAI (e.g. a gpt-4.1-mini deployment) over plain REST, no SDK. Loop: send the
// conversation + tool declarations; if the model asks for tool calls, run them and send the
// results back; repeat until it answers in text.

const MAX_STEPS = 5

export type ChatTurn = { role: 'user' | 'assistant'; text: string }

export class ChatConfigError extends Error {}

let skillCache: Promise<string> | undefined
function loadSkill() {
  skillCache ??= readFile(path.join(process.cwd(), 'src/server/chatbot/SKILL.md'), 'utf8')
  return skillCache
}

type Args = Record<string, unknown>

// ---------------------------------------------------------------------------------------------
// Azure OpenAI (chat completions + tools)
// ---------------------------------------------------------------------------------------------

type AzureToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }
type AzureMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: AzureToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

/** The tool declarations use upper-case schema types; OpenAI wants lower-case. */
function lowerTypes(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(lowerTypes)
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [
        k,
        k === 'type' && typeof v === 'string' ? v.toLowerCase() : lowerTypes(v),
      ]),
    )
  }
  return node
}

export type ChatAnswer = { reply: string; visuals: ChatVisual[] }

async function answerAzure(
  system: string,
  history: ChatTurn[],
  scope: ToolScope,
): Promise<ChatAnswer> {
  const visuals: ChatVisual[] = []
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/+$/, '')
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT
  const apiKey = process.env.AZURE_OPENAI_API_KEY
  if (!endpoint || !deployment || !apiKey) {
    throw new ChatConfigError('AZURE_OPENAI_ENDPOINT / _DEPLOYMENT / _API_KEY must all be set')
  }
  // The versionless /openai/v1 route (Foundry and Azure OpenAI resources); `model` is the deployment name.
  const url = `${endpoint}/openai/v1/chat/completions`
  const tools = TOOL_DECLARATIONS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: lowerTypes(t.parameters) },
  }))

  const messages: AzureMessage[] = [
    { role: 'system', content: system },
    ...history.map((m) => ({ role: m.role, content: m.text }) as AzureMessage),
  ]

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        model: deployment,
        messages,
        tools,
        temperature: 0.3,
        max_tokens: 1500,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      console.error('[chat] azure openai error', res.status, (await res.text()).slice(0, 300))
      throw new Error(`Azure OpenAI request failed (${res.status})`)
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: AzureToolCall[] } }[]
    }
    const msg = data.choices?.[0]?.message
    const calls = msg?.tool_calls ?? []

    if (calls.length === 0) {
      const text = msg?.content?.trim()
      if (text) return { reply: text, visuals }
      throw new Error('Empty model response')
    }

    messages.push({ role: 'assistant', content: msg?.content ?? null, tool_calls: calls })
    const results = await Promise.all(
      calls.map(async (c) => {
        let args: Args = {}
        try {
          args = JSON.parse(c.function.arguments || '{}') as Args
        } catch {
          // Malformed arguments: the tool reports the missing fields back to the model.
        }
        const out = await runTool(c.function.name, args, scope)
        if (out.visual) visuals.push(out.visual)
        return {
          role: 'tool',
          tool_call_id: c.id,
          content: JSON.stringify(out.result),
        } as AzureMessage
      }),
    )
    messages.push(...results)
  }
  throw new Error('Too many tool steps')
}

export async function answer(history: ChatTurn[], scope: ToolScope): Promise<ChatAnswer> {
  const system = `${await loadSkill()}

Today's date: ${new Date().toISOString().slice(0, 10)}.`
  return answerAzure(system, history, scope)
}
