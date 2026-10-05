import { getCurrentUser } from '@/server/auth/session'

export const runtime = 'nodejs'

const MAX_BYTES = 8 * 1024 * 1024

/**
 * Speech to text for the chat's mic button. The browser records a short clip (as WAV) and posts it
 * here; Azure Speech "fast transcription" (MAI-Transcribe) transcribes it. The candidate locales
 * are English and Hindi, so the service picks the spoken one itself: English comes back in Latin
 * script and Hindi in Devanagari, with no language switch in the UI.
 *
 * Session-authenticated like /api/chat. Body: multipart/form-data with an `audio` file.
 * Env: AZURE_SPEECH_ENDPOINT (e.g. https://<resource>.cognitiveservices.azure.com),
 * AZURE_SPEECH_KEY, optional AZURE_SPEECH_API_VERSION.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Only the origin matters: a pasted Foundry "project endpoint" (…/api/projects/<name>) would
  // otherwise get the speech path appended after it and be rejected as a wrong endpoint.
  let endpoint: string | undefined
  try {
    endpoint = process.env.AZURE_SPEECH_ENDPOINT
      ? new URL(process.env.AZURE_SPEECH_ENDPOINT).origin
      : undefined
  } catch {
    endpoint = undefined
  }
  const apiKey = process.env.AZURE_SPEECH_KEY
  if (!endpoint || !apiKey) {
    return Response.json({ error: 'Voice input is not configured yet.' }, { status: 503 })
  }
  const version = process.env.AZURE_SPEECH_API_VERSION || '2025-10-15'

  const form = await request.formData().catch(() => null)
  const audio = form?.get('audio')
  if (!(audio instanceof File) || audio.size === 0) {
    return Response.json({ error: 'Send an audio clip' }, { status: 400 })
  }
  if (audio.size > MAX_BYTES) {
    return Response.json({ error: 'That recording is too long.' }, { status: 413 })
  }

  const upstream = new FormData()
  upstream.append('audio', audio, audio.name || 'speech.wav')
  upstream.append(
    'definition',
    JSON.stringify({
      locales: ['en-US', 'hi-IN'],
      profanityFilterMode: 'None',
      phraseList: {
        phrases: [
          'Kumbh Mela',
          'Bairagicamp',
          'Harkipaudi',
          'Laxmanjhula',
          'Rishikesh',
          'Haridwar',
        ],
      },
    }),
  )

  try {
    const res = await fetch(
      `${endpoint}/speechtotext/transcriptions:transcribe?api-version=${version}`,
      {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': apiKey },
        body: upstream,
        signal: AbortSignal.timeout(30_000),
      },
    )
    // 422 "No language was identified": the clip had no recognisable speech in it.
    if (res.status === 422) return Response.json({ text: '' })
    if (!res.ok) {
      console.error('[transcribe] speech error', res.status, (await res.text()).slice(0, 400))
      return Response.json({ error: 'Could not transcribe that.' }, { status: 502 })
    }
    const data = (await res.json()) as {
      combinedPhrases?: { text?: string }[]
      phrases?: { text?: string }[]
    }
    const text = (
      data.combinedPhrases?.map((p) => p.text ?? '').join(' ') ||
      data.phrases?.map((p) => p.text ?? '').join(' ') ||
      ''
    ).trim()
    return Response.json({ text })
  } catch (err) {
    console.error('[transcribe] failed', err)
    return Response.json({ error: 'Could not transcribe that.' }, { status: 502 })
  }
}
