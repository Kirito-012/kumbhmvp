import Link from 'next/link'
import { SearchX } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.04] text-muted-strong">
        <SearchX className="h-6 w-6" strokeWidth={1.75} />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-foreground">Page not found</h1>
        <p className="mt-1 text-sm text-muted">
          The page you&rsquo;re looking for doesn&rsquo;t exist or was moved.
        </p>
      </div>
      <Link
        href="/dashboard"
        className="mt-2 inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-black transition-colors hover:bg-accent-strong"
      >
        Back to dashboard
      </Link>
    </div>
  )
}
