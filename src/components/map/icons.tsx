// Small inline SVG icon set (Heroicons-outline-style, hand-rolled to avoid
// an extra dependency for ~10 glyphs). Every icon is 1.5px stroke, 24x24
// viewBox, sized via className so callers control size/color with Tailwind.

type IconProps = { className?: string }

const base = 'stroke-current'

export function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" className={base} strokeWidth={1.6} />
      <path d="M21 21l-4.3-4.3" className={base} strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  )
}

export function ChartBarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 20V10M12 20V4M20 20v-7"
        className={base}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function LayersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3l8 4.5-8 4.5-8-4.5L12 3z"
        className={base}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <path
        d="M4 12l8 4.5 8-4.5M4 16.5L12 21l8-4.5"
        className={base}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6 9l6 6 6-6"
        className={base}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function XIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" className={base} strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

export function MapPinIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 21s7-6.1 7-11.5S16.4 3 12 3 5 5.6 5 9.5 12 21 12 21z"
        className={base}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="2.4" className={base} strokeWidth={1.6} />
    </svg>
  )
}

export function TagIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M11.3 3.6H5.6c-1.1 0-2 .9-2 2v5.7c0 .5.2 1 .6 1.4l8.3 8.3c.8.8 2 .8 2.8 0l5.7-5.7c.8-.8.8-2 0-2.8l-8.3-8.3c-.4-.4-.9-.6-1.4-.6z"
        className={base}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <circle cx="8.2" cy="8.2" r="1.1" className={base} strokeWidth={1.5} />
    </svg>
  )
}

export function SlidersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h13M20 18h0"
        className={base}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <circle cx="13" cy="6" r="2" className={base} strokeWidth={1.6} />
      <circle cx="7" cy="12" r="2" className={base} strokeWidth={1.6} />
      <circle cx="17" cy="18" r="2" className={base} strokeWidth={1.6} />
    </svg>
  )
}

export function CompassIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" className={base} strokeWidth={1.6} />
      <path d="M15 9l-2 6-6 2 2-6 6-2z" className={base} strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  )
}
