import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Noto_Sans_Devanagari } from 'next/font/google'
import { THEME_INIT_SCRIPT } from '@/lib/theme'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

// Geist has no Devanagari, so Hindi text used to fall back to a thin system font. Noto Sans
// Devanagari is a clean, even-stroked face that stays legible at small sizes; the browser picks it
// per glyph, so English text keeps Geist.
const notoDevanagari = Noto_Sans_Devanagari({
  variable: '--font-devanagari',
  subsets: ['devanagari'],
  display: 'swap',
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

// Mobile keyboards shrink the layout viewport, so a fixed bottom panel keeps its composer visible.
export const viewport: Viewport = { interactiveWidget: 'resizes-content' }

export const metadata: Metadata = {
  title: 'Kumbh Drishti',
  description: 'Field ticketing and GIS for Kumbh Mela 2027 — Haridwar–Rishikesh.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${notoDevanagari.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_INIT_SCRIPT,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  )
}
