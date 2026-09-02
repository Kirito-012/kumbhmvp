'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { Mail, Lock, ArrowRight, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { login } from '@/server/actions/auth.actions'

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, undefined)
  const [showPassword, setShowPassword] = useState(false)

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-muted-strong">
          Email address
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            id="email"
            name="email"
            type="text"
            autoComplete="email"
            required
            placeholder="you@company.com"
            className="h-10 w-full rounded-lg border border-border-strong bg-overlay pl-9 pr-3 text-sm text-foreground placeholder:text-muted/60 outline-none transition-colors focus:border-accent/50 focus:bg-overlay-strong focus:ring-2 focus:ring-accent/20"
          />
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="password" className="block text-xs font-medium text-muted-strong">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-accent-strong hover:text-accent"
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            placeholder="••••••••••"
            className="h-10 w-full rounded-lg border border-border-strong bg-overlay pl-9 pr-9 text-sm text-foreground placeholder:text-muted/60 outline-none transition-colors focus:border-accent/50 focus:bg-overlay-strong focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
            className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted hover:text-foreground"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-strong">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 cursor-pointer rounded border-border-strong bg-transparent accent-emerald-500"
        />
        Keep me signed in for 30 days
      </label>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
        {!pending && <ArrowRight className="h-4 w-4" />}
      </Button>
    </form>
  )
}
