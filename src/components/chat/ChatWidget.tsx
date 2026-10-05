'use client'

import {
  CornerDownLeft,
  Loader2,
  Maximize2,
  MessageSquareText,
  Mic,
  Minimize2,
  RotateCcw,
  Send,
  Square,
  Volume2,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { ChatVisuals } from '@/components/chat/ChatVisuals'
import type { ChatVisual } from '@/lib/chat/visuals'
import type { MutableRefObject } from 'react'
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

type Msg = {
  role: 'user' | 'assistant'
  text: string
  error?: boolean
  visuals?: ChatVisual[]
  at?: string
}

// One bilingual interface: the assistant replies in whichever language the user writes in
// (English or Hindi), so the static labels simply show both.
const t = {
  title: 'Kumbh Assistant',
  statusIdle: 'Ready · tickets live · work progress demo',
  statusBusy: 'Looking up your answer…',
  heading: 'Ask about any sector’s works or tickets',
  listening: 'Listening — speak in English or हिन्दी',
  micHint: 'stops on pause',
  allowMic: 'Allow microphone access…',
  liveLine: 'Tickets you are allowed to see',
  demoLine: 'Work progress is sample data',
  voiceLine: 'Tap the mic and speak English or हिन्दी',
  tryAsking: 'Try asking',
  launcher: 'Ask about sectors & tickets',
  replyReady: 'Reply ready',
  working: 'Working…',
  retry: 'Retry',
  readAloud: 'Read aloud',
  placeholder: 'Sector, work head or ticket #…',
  send: 'Send',
  open: 'Open assistant',
  close: 'Close',
  reset: 'New chat',
  expand: 'Expand',
  shrink: 'Collapse',
  micStart: 'Speak',
  micStop: 'Done speaking',
  micCancel: 'Cancel',
  stopSpeaking: 'Stop reading aloud',
  slow: 'Checking sector data and tickets — this can take about 15 seconds.',
  transcribing: 'Transcribing…',
  noHindiVoice: 'No Hindi voice on this device — install one in system speech settings.',
}

const SUGGESTIONS = [
  { tag: 'Roads', text: "What's the update on roads in sector 30?" },
  { tag: 'Camp', text: 'Show me updates on Bairagicamp' },
  { tag: 'Tickets', text: 'Open tickets in sector 12' },
  { tag: 'Water', text: 'Delayed water works in sector 5' },
  { tag: 'हिन्दी', text: 'सेक्टर 12 में खुले टिकट' },
]

// --- Voice input -----------------------------------------------------------------------------
// The mic records a short clip and /api/transcribe turns it into text; the model detects English
// or Hindi itself, so there is no language switch. Recording stops on a pause in speech.
const hasRecorder = () =>
  typeof window !== 'undefined' &&
  typeof MediaRecorder !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia

/** The speech service wants WAV/MP3/FLAC, but browsers record WebM or MP4. Decode the clip and
 *  re-encode it as 16 kHz mono 16-bit WAV (small, and what speech models expect). */
async function toWav16k(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const rate = 16000
    const offline = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(decoded.duration * rate)),
      rate,
    )
    const src = offline.createBufferSource()
    src.buffer = decoded
    src.connect(offline.destination)
    src.start()
    const pcm = (await offline.startRendering()).getChannelData(0)

    const view = new DataView(new ArrayBuffer(44 + pcm.length * 2))
    const text = (at: number, s: string) =>
      [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
    text(0, 'RIFF')
    view.setUint32(4, 36 + pcm.length * 2, true)
    text(8, 'WAVEfmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // mono
    view.setUint32(24, rate, true)
    view.setUint32(28, rate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    text(36, 'data')
    view.setUint32(40, pcm.length * 2, true)
    for (let i = 0; i < pcm.length; i++) {
      const v = Math.max(-1, Math.min(1, pcm[i]))
      view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
    }
    return new Blob([view], { type: 'audio/wav' })
  } finally {
    void ctx.close()
  }
}

function pickMime(): string | undefined {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) =>
    MediaRecorder.isTypeSupported(m),
  )
}

// --- Speech output (browser speechSynthesis) ---------------------------------------------------
const hasSynth = () => typeof window !== 'undefined' && 'speechSynthesis' in window

/** Reply text without markdown marks, split into short pieces (long utterances get cut off by
 *  some engines). */
function speechChunks(text: string): string[] {
  return text
    .replace(/\*\*/g, '')
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^\s*[-*•]\s+/, '')
        .replace(/#(\d+)/g, ' $1')
        .trim(),
    )
    .filter(Boolean)
    .flatMap((l) => l.match(/[^.।!?]+[.।!?]?/g) ?? [l])
    .map((c) => c.trim())
    .filter(Boolean)
}

/** Devanagari in the reply means a Hindi answer; otherwise English (Indian accent if available). */
function pickVoice(text: string): { lang: string; voice?: SpeechSynthesisVoice; missing: boolean } {
  const hindi = /[ऀ-ॿ]/.test(text)
  const voices = window.speechSynthesis.getVoices()
  const find = (prefix: string) =>
    voices.find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(prefix))
  if (hindi) {
    const voice = find('hi')
    return { lang: 'hi-IN', voice, missing: !voice }
  }
  return { lang: 'en-IN', voice: find('en-in') ?? find('en'), missing: false }
}

/** Minimal inline rendering for the model's reply: **bold**, "- " bullets, line breaks. */
function renderInline(line: string) {
  return line.split(/(\*\*[^*]+\*\*|`[^`]+`|(?<![\w/&])#\d{1,7}\b)/g).map((part, i, parts) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="font-mono text-[0.92em]">
          {part.slice(1, -1)}
        </code>
      )
    }
    const ticket = part.match(/^#(\d+)$/)
    if (ticket && !/(sector|head|सेक्टर|no\.?)\s*$/i.test(parts[i - 1] ?? '')) {
      return (
        <Link
          key={i}
          href={`/tickets/${ticket[1]}`}
          className="font-mono text-[var(--accent-text)] hover:underline"
        >
          {part}
        </Link>
      )
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** What the reply was built from, derived from the visuals that came back with it. */
function provenance(visuals: ChatVisual[], at?: string): string {
  const parts = visuals.map((v) => {
    const sec = v.sector ? ` · sector ${v.sector.no}` : ''
    return v.type === 'progress' ? `work progress (demo)${sec}` : `tickets${sec}`
  })
  return [...new Set(parts), ...(at ? [at] : [])].join(' · ')
}

function Reply({ text }: { text: string }) {
  return (
    <div className="space-y-1.5">
      {text.split('\n').map((raw, i) => {
        const line = raw.trimEnd()
        if (!line.trim()) return null
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
        if (bullet) {
          return (
            <p key={i} className="flex gap-2 pl-1">
              <span aria-hidden className="text-muted-strong">
                •
              </span>
              <span className="min-w-0 flex-1">{renderInline(bullet[1])}</span>
            </p>
          )
        }
        return <p key={i}>{renderInline(line)}</p>
      })}
    </div>
  )
}

/** Elapsed-seconds status while the request runs. Not a live region itself: the message log
 *  already announces the reply, and the header status line carries the "busy" state. */
function Thinking() {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setSecs((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="chat-in border-l-2 border-[var(--accent)] pl-3.5 text-sm text-muted-strong">
      <p className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        {t.working}
        <span className="font-mono text-[12px] tabular-nums" aria-hidden>
          {secs}s
        </span>
      </p>
      {secs >= 8 && <p className="mt-1 text-[13px]">{t.slow}</p>}
    </div>
  )
}

const BARS = 36

/** Live input-level bars plus a clock. Owns its own state so the 100 ms level updates re-render
 *  only this strip, not the whole message list. The parent pushes samples through `sink`. */
function Waveform({ sinkRef }: { sinkRef: MutableRefObject<((v: number) => void) | null> }) {
  const [levels, setLevels] = useState<number[]>([])
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    sinkRef.current = (v) => setLevels((l) => [...l.slice(-(BARS - 1)), v])
    const id = setInterval(() => setSecs((n) => n + 1), 1000)
    return () => {
      sinkRef.current = null
      clearInterval(id)
    }
  }, [sinkRef])
  return (
    <>
      <div
        className="flex h-6 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden"
        aria-hidden
      >
        {Array.from({ length: BARS }, (_, n) => {
          const v = levels[levels.length - BARS + n] ?? 0
          return (
            <span
              key={n}
              className="w-[3px] shrink-0 rounded-full bg-[var(--danger)] transition-[height] duration-100"
              style={{ height: `${Math.max(12, v * 100)}%`, opacity: 0.35 + v * 0.65 }}
            />
          )
        })}
      </div>
      <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-strong">
        0:{String(secs).padStart(2, '0')}
      </span>
    </>
  )
}

/** `overlay` is the full-bleed map page: its zoom / 3D / compass controls fill the bottom-right
 *  corner, so the launcher and panel sit just left of them instead of on top. */
export function ChatWidget({ variant = 'pinned' }: { variant?: 'pinned' | 'overlay' }) {
  const rightEdge = variant === 'overlay' ? 'right-[76px]' : 'right-5'
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [unread, setUnread] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const gen = useRef(0)
  const logRef = useRef<HTMLDivElement>(null)
  const [speechNote, setSpeechNote] = useState<string | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  // Server render and first client render say false (no hydration mismatch), then it flips.
  const micSupported = useSyncExternalStore(
    () => () => {},
    hasRecorder,
    () => false,
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const levelSink = useRef<((v: number) => void) | null>(null)
  const starting = useRef(false)
  const openRef = useRef(false)
  const recRef = useRef<{ stop: () => void; cancel: () => void } | null>(null)
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null)

  const launcherRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  useEffect(() => {
    openRef.current = open
    if (open) {
      // Skip autofocus on touch devices: the keyboard would cover the suggestions.
      if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
    } else if (wasOpen.current) launcherRef.current?.focus()
    wasOpen.current = open
  }, [open])

  // "/" opens the assistant from anywhere (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      e.preventDefault()
      if (openRef.current) {
        inputRef.current?.focus()
        return
      }
      setUnread(false)
      setOpen(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  /** Escape cancels a recording first; otherwise it closes the panel. */
  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Escape') return
    if (recRef.current) {
      recRef.current.cancel()
      return
    }
    stopSpeaking()
    setOpen(false)
  }

  useEffect(() => {
    const log = logRef.current
    if (!log) return
    const last = messages[messages.length - 1]
    const el = log.querySelector<HTMLElement>('[data-last-reply]')
    if (last?.role === 'assistant' && !busy && el) {
      log.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' })
    } else {
      log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, busy, open])

  const stopSpeaking = useCallback(() => {
    if (hasSynth()) window.speechSynthesis.cancel()
    setSpeakingIdx(null)
  }, [])

  const speak = useCallback((text: string, idx: number) => {
    if (!hasSynth()) return
    window.speechSynthesis.cancel()
    const { lang, voice, missing } = pickVoice(text)
    if (missing && window.speechSynthesis.getVoices().length > 0) setSpeechNote(t.noHindiVoice)
    const chunks = speechChunks(text)
    if (chunks.length === 0) return
    setSpeakingIdx(idx)
    chunks.forEach((chunk, n) => {
      const u = new SpeechSynthesisUtterance(chunk)
      u.lang = voice?.lang ?? lang
      if (voice) u.voice = voice
      u.rate = 0.95
      if (n === chunks.length - 1) {
        u.onend = () => setSpeakingIdx((cur) => (cur === idx ? null : cur))
        u.onerror = () => setSpeakingIdx((cur) => (cur === idx ? null : cur))
      }
      window.speechSynthesis.speak(u)
    })
  }, [])

  // Stop the mic and speech when the widget unmounts.
  useEffect(() => {
    return () => {
      recRef.current?.cancel()
      if (hasSynth()) window.speechSynthesis.cancel()
    }
  }, [])

  async function transcribe(blob: Blob) {
    const mine = gen.current
    setTranscribing(true)
    try {
      const body = new FormData()
      body.append('audio', await toWav16k(blob), 'speech.wav')
      const res = await fetch('/api/transcribe', { method: 'POST', body })
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
      if (mine !== gen.current) return
      if (!res.ok) {
        setMicError(data.error ?? 'Voice input failed.')
      } else if (!data.text) {
        setMicError('Didn’t catch that. Try again.')
      } else {
        setInput((prev) => (prev.trim() ? `${prev.trim()} ` : '') + data.text)
      }
    } catch {
      if (mine === gen.current) setMicError('Voice input failed.')
    } finally {
      setTranscribing(false)
      // The input is re-mounted by the state change above, so focus on the next frame.
      focusInput()
    }
  }

  const focusInput = () =>
    requestAnimationFrame(() => {
      if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
    })

  async function startListening() {
    if (starting.current) return
    starting.current = true
    setMicError(null)
    setRequesting(true)
    const mineGen = gen.current
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      starting.current = false
      setRequesting(false)
      setMicError('Microphone blocked — allow it in the browser.')
      return
    }
    setRequesting(false)
    if (!openRef.current || mineGen !== gen.current) {
      // Panel was closed while the permission prompt was up.
      stream.getTracks().forEach((track) => track.stop())
      starting.current = false
      return
    }
    const mime = pickMime()
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    } catch {
      stream.getTracks().forEach((track) => track.stop())
      starting.current = false
      setMicError('Recording isn’t supported in this browser.')
      return
    }
    const chunks: Blob[] = []
    let cancelled = false
    let heardSpeech = false
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }

    // Stop on a pause after speech, after 8 s of silence, or at 30 s.
    const ctx = new AudioContext()
    void ctx.resume() // Safari can start suspended, which flatlines the analyser
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    // eslint-disable-next-line react-hooks/purity -- runs in a click handler, not during render
    const startedAt = Date.now()
    let lastLoud = startedAt
    let floor = 0 // ambient noise, measured over the first 400 ms
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples)
      let peak = 0
      for (const v of samples) peak = Math.max(peak, Math.abs(v - 128))
      const now = Date.now()
      levelSink.current?.(Math.min(1, Math.max(0, peak - floor) / 50))
      if (now - startedAt < 400) {
        floor = Math.min(18, Math.max(floor * 0.9, peak))
        return
      }
      if (peak > Math.max(6, floor * 2.2)) {
        heardSpeech = true
        lastLoud = now
      }
      const paused = heardSpeech && now - lastLoud > 1600
      const silent = !heardSpeech && now - startedAt > 8000
      if ((paused || silent || now - startedAt > 30_000) && rec.state !== 'inactive') rec.stop()
    }, 100)

    rec.onstop = () => {
      clearInterval(timer)
      stream.getTracks().forEach((track) => track.stop())
      void ctx.close()
      recRef.current = null
      setListening(false)
      if (cancelled) {
        focusInput()
        return
      }
      if (!heardSpeech) {
        setMicError('Didn’t hear anything.')
        focusInput()
        return
      }
      const type = rec.mimeType || mime || 'audio/webm'
      void transcribe(new Blob(chunks, { type }))
    }

    recRef.current = {
      stop: () => rec.state !== 'inactive' && rec.stop(),
      cancel: () => {
        cancelled = true
        if (rec.state !== 'inactive') rec.stop()
      },
    }
    rec.start()
    starting.current = false
    setListening(true)
  }

  function toggleMic() {
    if (transcribing || requesting) return
    if (listening) recRef.current?.stop()
    else void startListening()
  }

  async function send(raw: string, base: Msg[] = messages) {
    const text = raw.trim()
    if (!text || busy) return
    gen.current++
    recRef.current?.cancel()
    stopSpeaking()
    setSpeechNote(null)
    // A question whose answer failed is dropped, so the model never sees it twice.
    const kept = base.filter((m, i) => !m.error && !(m.role === 'user' && base[i + 1]?.error))
    const next: Msg[] = [...kept, { role: 'user', text }]
    setMessages(next)
    setInput('')
    setMicError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: next.filter((m) => !m.error).map(({ role, text }) => ({ role, text })),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string
        error?: string
        visuals?: ChatVisual[]
      }
      const ok = res.ok && !!data.reply
      if (!openRef.current) setUnread(true)
      setMessages((m) => [
        ...m,
        ok
          ? {
              role: 'assistant',
              text: data.reply!,
              visuals: data.visuals ?? [],
              at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            }
          : { role: 'assistant', text: data.error ?? 'Something went wrong.', error: true },
      ])
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: 'Network error.', error: true }])
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        ref={launcherRef}
        type="button"
        onClick={() => {
          setUnread(false)
          setOpen(true)
        }}
        aria-haspopup="dialog"
        aria-label={unread ? `${t.launcher} — ${t.replyReady}` : undefined}
        className={`chat-launcher fixed bottom-5 ${rightEdge} z-40 flex h-12 items-center gap-2.5 rounded-[var(--radius-md)] bg-[var(--accent)] px-4 text-[15px] font-semibold text-[#04120c] shadow-lg transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]`}
      >
        <MessageSquareText className="h-[18px] w-[18px]" aria-hidden />
        <span className="sm:hidden">Ask</span>
        <span className="hidden sm:inline">{t.launcher}</span>
        {unread ? (
          <span className="rounded-[4px] bg-[#04120c] px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-[#34d399]">
            {t.replyReady}
          </span>
        ) : (
          <kbd
            className="hidden rounded-[4px] border border-[#04120c]/30 px-1.5 font-mono text-[11px] sm:inline"
            aria-hidden
          >
            /
          </kbd>
        )}
      </button>
    )
  }

  return (
    <section
      data-chat
      onKeyDown={onPanelKeyDown}
      role="dialog"
      aria-label={t.title}
      className={`chat-pop fixed inset-x-3 bottom-3 z-40 flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl transition-[width,height] duration-200 sm:inset-x-auto sm:bottom-5 ${variant === 'overlay' ? 'sm:right-[76px]' : 'sm:right-5'} ${
        expanded
          ? `h-[calc(100dvh-24px)] sm:h-[calc(100dvh-40px)] ${
              // The map page keeps 76px clear on the right for its zoom controls, so the wide
              // panel must leave that much room too or it runs off the left edge on tablets.
              variant === 'overlay'
                ? 'sm:w-[min(1000px,calc(100vw-96px))]'
                : 'sm:w-[min(1000px,calc(100vw-40px))]'
            }`
          : 'h-[min(680px,calc(100dvh-24px))] sm:w-[420px]'
      }`}
    >
      <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--background-elevated)] py-3 pl-4 pr-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-baseline gap-2 text-[16px] font-semibold leading-tight text-foreground">
            <span className="truncate">{t.title}</span>
            <span className="shrink-0 font-mono text-[11px] font-normal text-muted-strong">
              EN · हिं
            </span>
          </h2>
          <p className="mt-1 flex items-center gap-1.5 truncate text-[12.5px] text-muted-strong">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${busy ? 'chat-busy bg-[var(--warning)]' : 'bg-[var(--accent-strong)]'}`}
              aria-hidden
            />
            <span className="truncate">{busy ? t.statusBusy : t.statusIdle}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? t.shrink : t.expand}
          title={expanded ? t.shrink : t.expand}
          className="hidden rounded-[var(--radius-sm)] p-2 text-muted-strong hover:bg-[var(--surface-hover)] sm:inline-flex"
        >
          {expanded ? (
            <Minimize2 className="h-[18px] w-[18px]" aria-hidden />
          ) : (
            <Maximize2 className="h-[18px] w-[18px]" aria-hidden />
          )}
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              gen.current++
              recRef.current?.cancel()
              stopSpeaking()
              setMessages([])
              setInput('')
              setMicError(null)
              setSpeechNote(null)
            }}
            disabled={busy}
            aria-label={t.reset}
            title={t.reset}
            className="rounded-[var(--radius-sm)] p-2 text-muted-strong hover:bg-[var(--surface-hover)] disabled:opacity-40"
          >
            <RotateCcw className="h-[18px] w-[18px]" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            recRef.current?.cancel()
            stopSpeaking()
            setOpen(false)
          }}
          aria-label={t.close}
          className="rounded-[var(--radius-sm)] p-2 text-muted-strong hover:bg-[var(--surface-hover)]"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        className="@container min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 text-[15px] leading-relaxed"
      >
        {messages.length === 0 && (
          <div className="chat-in">
            <h3 className="text-xl font-semibold leading-snug text-foreground">{t.heading}</h3>
            <dl className="mt-3 space-y-1 font-mono text-[12px] text-muted-strong">
              <div className="flex gap-3">
                <dt className="w-12 shrink-0 font-semibold text-[var(--accent-text)]">LIVE</dt>
                <dd>{t.liveLine}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-12 shrink-0 font-semibold text-[var(--warning-text)]">DEMO</dt>
                <dd>{t.demoLine}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-12 shrink-0 font-semibold text-foreground">VOICE</dt>
                <dd>{t.voiceLine}</dd>
              </div>
            </dl>
            <p className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted-strong">
              {t.tryAsking}
            </p>
            <ul className="mt-2 border-t border-[var(--border)]">
              {SUGGESTIONS.map(({ tag, text }) => (
                <li key={text}>
                  <button
                    type="button"
                    onClick={() => {
                      void send(text)
                      focusInput()
                    }}
                    className="group flex w-full items-baseline gap-3 border-b border-[var(--border)] px-1 py-3 text-left text-[14.5px] leading-snug text-foreground transition-colors hover:bg-[var(--accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-strong)]"
                  >
                    <span className="w-14 shrink-0 font-mono text-[11px] uppercase tracking-wide text-[var(--accent-text)]">
                      {tag}
                    </span>
                    <span className="min-w-0 flex-1">{text}</span>
                    <CornerDownLeft
                      className="h-3.5 w-3.5 shrink-0 self-center text-muted-strong opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="chat-in flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--overlay)] px-3 py-2 text-foreground">
                {m.text}
              </div>
            </div>
          ) : (
            <div
              key={i}
              data-last-reply={i === messages.length - 1 ? '' : undefined}
              className={`chat-in min-w-0 border-l-2 pl-3.5 ${m.error ? 'border-[var(--danger)]' : 'border-[var(--accent)]'}`}
            >
              {m.error ? (
                <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-foreground">
                  <span>{m.text}</span>
                  {i > 0 && i === messages.length - 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const last = messages[i - 1]
                        const base = messages.slice(0, i - 1)
                        setMessages(base)
                        void send(last.text, base)
                        focusInput()
                      }}
                      disabled={busy}
                      className="shrink-0 text-[13px] font-semibold underline underline-offset-2"
                    >
                      {t.retry}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <Reply text={m.text} />
                  <ChatVisuals visuals={m.visuals ?? []} />
                  <div className="mt-2 flex items-center gap-1.5">
                    {hasSynth() && (
                      <button
                        type="button"
                        onClick={() => (speakingIdx === i ? stopSpeaking() : speak(m.text, i))}
                        aria-label={speakingIdx === i ? t.stopSpeaking : t.readAloud}
                        title={speakingIdx === i ? t.stopSpeaking : t.readAloud}
                        className="-ml-1.5 inline-flex rounded-[var(--radius-sm)] p-1.5 text-muted-strong hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-strong)]"
                      >
                        {speakingIdx === i ? (
                          <Square className="h-4 w-4 fill-current" aria-hidden />
                        ) : (
                          <Volume2 className="h-4 w-4" aria-hidden />
                        )}
                      </button>
                    )}
                    <span className="font-mono text-[11px] text-muted-strong">
                      {m.visuals?.length
                        ? `Checked: ${provenance(m.visuals, m.at)}`
                        : `No data lookup${m.at ? ` · ${m.at}` : ''}`}
                    </span>
                  </div>
                </>
              )}
            </div>
          ),
        )}

        {busy && <Thinking />}
      </div>

      <div className="border-t border-[var(--border)] bg-[var(--background-elevated)] p-3">
        {micError && (
          <p className="mb-2 px-1 text-sm text-[var(--danger)]" role="alert">
            {micError}
          </p>
        )}
        {speechNote && !micError && (
          <p className="mb-2 px-1 text-sm text-muted-strong">{speechNote}</p>
        )}
        {listening && (
          <p className="mb-2 px-1 font-mono text-[12px] text-muted-strong">
            {t.listening} · {t.micHint} · Esc to cancel
          </p>
        )}
        {requesting && <p className="mb-2 px-1 text-sm text-muted-strong">{t.allowMic}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void send(input)
          }}
          className="flex items-center gap-2"
        >
          {micSupported && (
            <button
              type="button"
              onClick={toggleMic}
              disabled={transcribing || requesting}
              aria-busy={requesting}
              aria-label={listening ? t.micStop : t.micStart}
              title={listening ? t.micStop : t.micStart}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] ${
                listening
                  ? 'chat-mic-live border-[var(--danger)] bg-[var(--danger)] text-[#2a0606]'
                  : input.trim()
                    ? 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--accent-text)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]'
                    : 'border-transparent bg-[var(--accent)] text-[#04120c] hover:brightness-110'
              }`}
            >
              {requesting ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              ) : listening ? (
                <Square className="h-4 w-4 fill-current" aria-hidden />
              ) : (
                <Mic className="h-5 w-5" aria-hidden />
              )}
            </button>
          )}
          {listening ? (
            <div className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-soft)] px-3">
              <Waveform sinkRef={levelSink} />
              <button
                type="button"
                onClick={() => recRef.current?.cancel()}
                aria-label={t.micCancel}
                title={t.micCancel}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] text-muted-strong hover:bg-[var(--danger-soft)] hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : transcribing ? (
            <div
              className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 font-mono text-[13px] text-muted-strong"
              role="status"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t.transcribing}
            </div>
          ) : (
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.placeholder}
              maxLength={1000}
              aria-label={t.placeholder}
              className="h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-base text-foreground placeholder:text-muted focus-visible:border-[var(--accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-strong)]"
            />
          )}
          <button
            type="submit"
            disabled={busy || listening || transcribing || !input.trim()}
            aria-label={t.send}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent)] text-[#04120c] transition hover:brightness-110 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]"
          >
            <Send className="h-5 w-5" aria-hidden />
          </button>
        </form>
      </div>
    </section>
  )
}
