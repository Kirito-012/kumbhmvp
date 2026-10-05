'use client'

import {
  Bot,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { ChatVisuals } from '@/components/chat/ChatVisuals'
import type { ChatVisual } from '@/lib/chat/visuals'
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

type Msg = { role: 'user' | 'assistant'; text: string; error?: boolean; visuals?: ChatVisual[] }

// One bilingual interface: the assistant replies in whichever language the user writes in
// (English or Hindi), so the static labels simply show both.
const t = {
  title: 'Assistant / सहायक',
  sub: 'Sector works & tickets / सेक्टर कार्य और टिकट',
  hint: 'Ask in English or हिन्दी about works in any sector or about tickets. Work figures are demo data. / किसी भी सेक्टर के कार्यों या टिकटों के बारे में पूछें। कार्य के आँकड़े डेमो हैं।',
  placeholder: 'Ask a question / अपना सवाल लिखें…',
  send: 'Send / भेजें',
  open: 'Open assistant / सहायक खोलें',
  close: 'Close / बंद करें',
  reset: 'New chat / नई बातचीत',
  expand: 'Make bigger / बड़ा करें',
  shrink: 'Make smaller / छोटा करें',
  micStart: 'Speak / बोलकर पूछें',
  micStop: 'Stop listening / सुनना बंद करें',
  stopSpeaking: 'Stop reading / पढ़ना बंद करें',
  noHindiVoice:
    'No Hindi voice on this device — install one in system speech settings. / इस डिवाइस में हिन्दी आवाज़ नहीं है।',
}

const SUGGESTIONS = [
  "What's the update on roads in sector 30?",
  'सेक्टर 30 की सड़क का क्या अपडेट है?',
  'Open tickets in sector 12',
  'सेक्टर 5 में पानी के विलंबित कार्य',
]

/** What the assistant is "doing" while the request runs; cycles so a slow answer feels alive. */
const THINKING = [
  'Checking the sector data… / सेक्टर का डेटा देख रहा हूँ…',
  'Looking up tickets… / टिकट खोज रहा हूँ…',
  'Writing the answer… / उत्तर लिख रहा हूँ…',
]

// --- Speech input (Web Speech API; Chrome/Edge/Safari, not Firefox) ----------------------------
// Browsers can't auto-detect the spoken language, so the mic has its own small EN/हि switch.
type SpeechLang = 'en-IN' | 'hi-IN'
type RecognitionResult = { 0: { transcript: string }; isFinal: boolean; length: number }
type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => Recognition

function getRecognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
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
  return line
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    )
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
              <span aria-hidden className="text-[var(--accent-strong)]">
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

function Avatar() {
  return (
    <span
      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]"
      aria-hidden
    >
      <Bot className="h-[18px] w-[18px]" />
    </span>
  )
}

/** Three bouncing dots plus a status line that cycles while the answer is being prepared. */
function Thinking() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % THINKING.length), 2600)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="chat-in flex items-start gap-2.5" role="status" aria-live="polite">
      <Avatar />
      <div className="rounded-2xl rounded-tl-md bg-[var(--overlay)] px-4 py-3">
        <div className="flex items-center gap-1.5" aria-hidden>
          {[0, 1, 2].map((d) => (
            <span
              key={d}
              className="chat-dot h-2 w-2 rounded-full bg-[var(--accent-strong)]"
              style={{ animationDelay: `${d * 160}ms` }}
            />
          ))}
        </div>
        <p key={i} className="chat-in mt-2 text-sm text-muted-strong">
          {THINKING[i]}
        </p>
        <div className="chat-shimmer mt-2.5 h-1.5 w-40 overflow-hidden rounded-full" aria-hidden />
      </div>
    </div>
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
  const [speechLang, setSpeechLang] = useState<SpeechLang>('en-IN')
  const [micError, setMicError] = useState<string | null>(null)
  // Server render and first client render say false (no hydration mismatch), then it flips.
  const micSupported = useSyncExternalStore(
    () => () => {},
    () => !!getRecognitionCtor(),
    () => false,
  )
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const recRef = useRef<Recognition | null>(null)
  const baseRef = useRef('')
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages, busy, open])

  const stopSpeaking = useCallback(() => {
    if (hasSynth()) window.speechSynthesis.cancel()
    setSpeakingIdx(null)
  }, [])

  const speak = useCallback((text: string, idx: number) => {
    if (!hasSynth()) return
    window.speechSynthesis.cancel()
    const { lang, voice, missing } = pickVoice(text)
    if (missing) setMicError(t.noHindiVoice)
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

  const stopListening = useCallback(() => {
    recRef.current?.stop()
  }, [])

  // Stop the mic when the panel closes or the widget unmounts.
  useEffect(() => {
    return () => {
      recRef.current?.abort()
      if (hasSynth()) window.speechSynthesis.cancel()
    }
  }, [])

  function toggleMic() {
    if (listening) return stopListening()
    const Ctor = getRecognitionCtor()
    if (!Ctor) return
    setMicError(null)
    const rec = new Ctor()
    rec.lang = speechLang
    rec.interimResults = true
    rec.continuous = false
    baseRef.current = input.trim() ? `${input.trim()} ` : ''
    rec.onresult = (e) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
      setInput(baseRef.current + text)
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setMicError('Microphone blocked — allow it in the browser. / माइक्रोफ़ोन की अनुमति दें।')
      } else if (e.error === 'no-speech') {
        setMicError('Didn’t hear anything. / कुछ सुनाई नहीं दिया।')
      } else if (e.error !== 'aborted') {
        setMicError('Voice input failed. / आवाज़ पहचान विफल रही।')
      }
    }
    rec.onend = () => {
      setListening(false)
      recRef.current = null
      inputRef.current?.focus()
    }
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }

  async function send(raw: string) {
    const text = raw.trim()
    if (!text || busy) return
    recRef.current?.abort()
    stopSpeaking()
    const next: Msg[] = [...messages, { role: 'user', text }]
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
      setMessages((m) => [
        ...m,
        ok
          ? { role: 'assistant', text: data.reply!, visuals: data.visuals ?? [] }
          : { role: 'assistant', text: data.error ?? 'Something went wrong.', error: true },
      ])
      if (ok) speak(data.reply!, next.length)
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: 'Network error.', error: true }])
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.open}
        className={`chat-launcher group fixed bottom-5 ${rightEdge} z-40 flex items-center gap-2.5 rounded-full bg-gradient-to-br from-[var(--accent-strong)] to-[var(--accent)] py-1.5 pl-1.5 pr-4 text-[#04120c] shadow-[0_8px_24px_-6px_rgba(16,185,129,0.65)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-6px_rgba(16,185,129,0.8)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]`}
      >
        <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[#06231a] text-[var(--accent-strong)]">
          <Bot
            className="h-6 w-6 transition group-hover:rotate-[-8deg] group-hover:scale-110"
            aria-hidden
          />
          <span
            className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-[#06231a] bg-[#a7f3d0]"
            aria-hidden
          />
        </span>
        <span className="text-[15px] font-semibold leading-tight">
          Ask AI
          <span className="block text-[12px] font-medium opacity-80">सहायक से पूछें</span>
        </span>
      </button>
    )
  }

  return (
    <section
      data-chat
      role="dialog"
      aria-label={t.title}
      className={`chat-pop fixed inset-x-3 bottom-3 z-40 flex flex-col overflow-hidden rounded-3xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl transition-[width,height] duration-200 sm:inset-x-auto sm:bottom-5 ${variant === 'overlay' ? 'sm:right-[76px]' : 'sm:right-5'} ${
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
      <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--background-elevated)] px-4 py-3.5">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[#04120c]"
          aria-hidden
        >
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-foreground">{t.title}</h2>
          <p className="truncate text-[13px] text-muted-strong">{t.sub}</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? t.shrink : t.expand}
          title={expanded ? t.shrink : t.expand}
          aria-pressed={expanded}
          className="hidden rounded-lg p-2 text-muted-strong hover:bg-[var(--surface-hover)] sm:inline-flex"
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
              setMessages([])
              setInput('')
            }}
            disabled={busy}
            aria-label={t.reset}
            title={t.reset}
            className="rounded-lg p-2 text-muted-strong hover:bg-[var(--surface-hover)] disabled:opacity-40"
          >
            <RotateCcw className="h-[18px] w-[18px]" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            recRef.current?.abort()
            stopSpeaking()
            setOpen(false)
          }}
          aria-label={t.close}
          className="rounded-lg p-2 text-muted-strong hover:bg-[var(--surface-hover)]"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      <div className="@container min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 text-[15px] leading-relaxed">
        {messages.length === 0 && (
          <div className="chat-in space-y-4">
            <div className="flex items-start gap-2.5">
              <Avatar />
              <p className="rounded-2xl rounded-tl-md bg-[var(--overlay)] px-3.5 py-2.5 text-foreground">
                {t.hint}
              </p>
            </div>
            <div className="flex flex-col gap-2 pl-[42px]">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-xl border border-[var(--border-strong)] px-3.5 py-2.5 text-left text-foreground transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="chat-in flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--accent)] px-3.5 py-2.5 text-[#04120c]">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="chat-in flex items-start gap-2.5">
              <Avatar />
              <div className="min-w-0 flex-1">
                <div
                  className={`max-w-[92%] rounded-2xl rounded-tl-md px-3.5 py-2.5 text-foreground ${
                    m.error
                      ? 'border border-[var(--danger)] bg-[var(--danger-soft)]'
                      : 'bg-[var(--overlay)]'
                  }`}
                >
                  <Reply text={m.text} />
                </div>
                <ChatVisuals visuals={m.visuals ?? []} />
              </div>
            </div>
          ),
        )}

        {busy && <Thinking />}
        <div ref={endRef} />
      </div>

      <div className="border-t border-[var(--border)] bg-[var(--background-elevated)] p-3">
        {speakingIdx !== null && (
          <button
            type="button"
            onClick={stopSpeaking}
            aria-label={t.stopSpeaking}
            className="chat-in mb-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] py-2.5 text-[15px] font-semibold text-[var(--accent-strong)] hover:brightness-110"
          >
            <Square className="h-4 w-4 fill-current" aria-hidden />
            Stop speaking / बोलना बंद करें
          </button>
        )}
        {micError && (
          <p className="mb-2 px-1 text-sm text-[var(--warning)]" role="alert">
            {micError}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void send(input)
          }}
          className="flex items-center gap-2"
        >
          <div
            className={`flex min-w-0 flex-1 items-center gap-1 rounded-2xl border bg-[var(--surface)] pl-3.5 pr-1.5 ${
              listening ? 'border-[var(--danger)]' : 'border-[var(--border-strong)]'
            } focus-within:border-[var(--accent-strong)]`}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? 'Listening… / सुन रहा हूँ…' : t.placeholder}
              maxLength={1000}
              aria-label={t.placeholder}
              className="min-w-0 flex-1 bg-transparent py-3 text-base text-foreground placeholder:text-muted focus:outline-none"
            />
            {micSupported && (
              <>
                <button
                  type="button"
                  onClick={() => setSpeechLang((l) => (l === 'en-IN' ? 'hi-IN' : 'en-IN'))}
                  disabled={listening}
                  aria-label="Speech language / बोलने की भाषा"
                  title="Speech language / बोलने की भाषा"
                  className="rounded-md px-1.5 py-1 text-xs font-semibold text-muted-strong hover:bg-[var(--surface-hover)] disabled:opacity-50"
                >
                  {speechLang === 'en-IN' ? 'EN' : 'हि'}
                </button>
                <button
                  type="button"
                  onClick={toggleMic}
                  aria-label={listening ? t.micStop : t.micStart}
                  title={listening ? t.micStop : t.micStart}
                  aria-pressed={listening}
                  className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
                    listening
                      ? 'chat-mic-live bg-[var(--danger)] text-white'
                      : 'text-muted-strong hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  {listening ? (
                    <MicOff className="h-[18px] w-[18px]" aria-hidden />
                  ) : (
                    <Mic className="h-[18px] w-[18px]" aria-hidden />
                  )}
                </button>
              </>
            )}
          </div>
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label={t.send}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] text-[#04120c] transition hover:brightness-110 disabled:opacity-40"
          >
            <Send className="h-5 w-5" aria-hidden />
          </button>
        </form>
      </div>
    </section>
  )
}
