'use client'

import { useActionState, useState } from 'react'
import { Mail, Lock, User, ArrowRight, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { registerAction, type RegisterState } from '@/server/actions/auth.actions'

export function RegisterForm() {
  const [state, formAction, pending] = useActionState<RegisterState, FormData>(
    registerAction,
    undefined,
  )
  const [showPassword, setShowPassword] = useState(false)

  if (state?.success) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft px-5 py-8 text-center">
        <CheckCircle2 className="h-8 w-8 text-accent-strong" />
        <p className="text-sm font-medium text-foreground">Request submitted</p>
        <p className="text-sm text-muted-strong">
          Wait till you&apos;re approved — an admin needs to review your account before you can sign
          in. You&apos;ll be able to log in once that happens.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="fullname" className="mb-1.5 block text-xs font-medium text-muted-strong">
          Full name
        </label>
        <div className="relative">
          <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            id="fullname"
            name="fullname"
            required
            maxLength={120}
            placeholder="Jane Doe"
            className="h-10 w-full rounded-lg border border-border-strong bg-white/[0.03] pl-9 pr-3 text-sm text-foreground placeholder:text-muted/60 outline-none transition-colors focus:border-accent/50 focus:bg-white/[0.05] focus:ring-2 focus:ring-accent/20"
          />
        </div>
      </div>

      <div>
        <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-muted-strong">
          Email address
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
            className="h-10 w-full rounded-lg border border-border-strong bg-white/[0.03] pl-9 pr-3 text-sm text-foreground placeholder:text-muted/60 outline-none transition-colors focus:border-accent/50 focus:bg-white/[0.05] focus:ring-2 focus:ring-accent/20"
          />
        </div>
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-muted-strong">
          Password
        </label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="At least 8 characters"
            className="h-10 w-full rounded-lg border border-border-strong bg-white/[0.03] pl-9 pr-9 text-sm text-foreground placeholder:text-muted/60 outline-none transition-colors focus:border-accent/50 focus:bg-white/[0.05] focus:ring-2 focus:ring-accent/20"
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

      <div>
        <p className="mb-1.5 block text-xs font-medium text-muted-strong">I am a</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-border-strong bg-white/[0.03] py-2.5 text-sm font-medium text-muted-strong transition-colors has-[:checked]:border-accent/50 has-[:checked]:bg-accent-soft has-[:checked]:text-accent-strong">
            <input type="radio" name="roleKey" value="manager" required className="sr-only" />
            Manager
          </label>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-border-strong bg-white/[0.03] py-2.5 text-sm font-medium text-muted-strong transition-colors has-[:checked]:border-accent/50 has-[:checked]:bg-accent-soft has-[:checked]:text-accent-strong">
            <input type="radio" name="roleKey" value="agent" required className="sr-only" />
            Agent
          </label>
        </div>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Submitting…' : 'Request access'}
        {!pending && <ArrowRight className="h-4 w-4" />}
      </Button>
    </form>
  )
}
