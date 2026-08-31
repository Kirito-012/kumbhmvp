import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' })

export function timeAgo(date: Date | string) {
  const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000)
  const abs = Math.abs(seconds)

  if (abs < 60) return 'just now'

  for (const [unit, secondsInUnit] of UNITS) {
    if (abs >= secondsInUnit) {
      return rtf.format(Math.round(seconds / secondsInUnit), unit)
    }
  }
  return 'just now'
}

export function initialsFor(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/)
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}
