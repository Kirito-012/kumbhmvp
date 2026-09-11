import Link from 'next/link'
import { BrandMark } from '@/components/ui/BrandMark'
import { LoginForm } from '@/components/auth/LoginForm'

const LAYERS = ['Sector plans', 'Ghats', 'Roads', 'Utilities', 'Transport', 'Sanitation']

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      {/* Left — cartographic panel */}
      <div className="relative hidden w-[46%] shrink-0 flex-col justify-between overflow-hidden border-r border-border bg-background-elevated p-10 lg:flex">
        <div className="bg-glow pointer-events-none absolute inset-0" />

        <div className="relative">
          <BrandMark wordmark />
        </div>

        <div className="relative max-w-md space-y-6">
          {/* Sector-plate illustration — a stylised map plate, not a real dataset */}
          <svg viewBox="0 0 400 280" fill="none" aria-hidden="true" className="w-full text-border">
            {/* graticule */}
            <g stroke="currentColor" strokeWidth="1" opacity="0.35">
              <line x1="0" y1="70" x2="400" y2="70" />
              <line x1="0" y1="140" x2="400" y2="140" />
              <line x1="0" y1="210" x2="400" y2="210" />
              <line x1="80" y1="0" x2="80" y2="280" />
              <line x1="160" y1="0" x2="160" y2="280" />
              <line x1="240" y1="0" x2="240" y2="280" />
              <line x1="320" y1="0" x2="320" y2="280" />
            </g>
            <g stroke="currentColor" strokeWidth="1.5" opacity="0.5">
              <line x1="0" y1="0" x2="0" y2="10" />
              <line x1="0" y1="0" x2="10" y2="0" />
              <line x1="400" y1="280" x2="400" y2="270" />
              <line x1="400" y1="280" x2="390" y2="280" />
            </g>

            {/* river band with ghat steps along one bank */}
            <path
              d="M -10 190 C 60 170, 110 220, 180 195 C 250 170, 300 210, 410 175"
              stroke="var(--accent)"
              strokeOpacity="0.35"
              strokeWidth="22"
              strokeLinecap="round"
            />
            <g stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="2">
              <line x1="70" y1="205" x2="70" y2="222" />
              <line x1="90" y1="203" x2="90" y2="222" />
              <line x1="110" y1="204" x2="110" y2="224" />
              <line x1="130" y1="208" x2="130" y2="228" />
              <line x1="150" y1="203" x2="150" y2="222" />
            </g>

            {/* sector parcels */}
            <g fill="var(--accent-soft)" stroke="var(--accent)" strokeOpacity="0.25">
              <polygon points="30,30 95,22 108,68 38,78" />
              <polygon points="120,20 190,32 178,72 118,66" />
              <polygon points="210,25 280,18 288,60 215,68" />
              <polygon points="300,30 365,40 358,82 295,75" />
              <polygon points="45,105 115,98 122,138 50,145" />
              <polygon points="230,110 300,100 305,142 235,148" />
              <polygon points="140,150 205,145 210,182 145,188" />
              <polygon points="270,155 340,150 345,190 275,195" />
            </g>

            {/* ticket pins */}
            <g>
              <circle cx="95" cy="45" r="5" fill="var(--muted)" opacity="0.6" />
              <circle cx="255" cy="130" r="5" fill="var(--muted)" opacity="0.6" />
              <circle cx="180" cy="165" r="7" fill="var(--accent)" />
              <circle
                cx="180"
                cy="165"
                r="13"
                stroke="var(--accent)"
                strokeOpacity="0.35"
                strokeWidth="2"
              />
            </g>
          </svg>

          <div className="space-y-2">
            <h2 className="text-xl font-medium leading-snug tracking-tight text-foreground">
              Field ticketing and GIS for Kumbh Mela 2027
            </h2>
            <p className="text-sm leading-relaxed text-muted">
              Sector plans, ghats, roads, utilities and sanitation across the Haridwar–Rishikesh
              mela area — surveyed, ticketed and tracked in one console.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border pt-5">
            {LAYERS.map((layer) => (
              <span
                key={layer}
                className="rounded-full border border-border-strong bg-overlay px-3 py-1 text-xs text-muted-strong"
              >
                {layer}
              </span>
            ))}
          </div>
        </div>

        <div className="relative flex items-center justify-between text-xs text-muted">
          <span className="font-mono">29.9457° N · 78.1642° E — Haridwar, Uttarakhand</span>
          <span>© 2027 TheCraftSync</span>
        </div>
      </div>

      {/* Right — form */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="mb-8 lg:hidden">
            <BrandMark wordmark />
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sign in</h1>
          <p className="mt-1.5 text-sm text-muted">Use your Kumbh Drishti account to continue</p>

          <div className="mt-7">
            <LoginForm />
          </div>

          <p className="mt-6 text-center text-sm text-muted">
            New to Kumbh Drishti?{' '}
            <Link href="/register" className="font-medium text-accent-strong hover:text-accent">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
