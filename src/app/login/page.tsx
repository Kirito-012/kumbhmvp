import Link from 'next/link'
import { Sparkles, ShieldCheck, Zap, Users } from 'lucide-react'
import { LoginForm } from '@/components/auth/LoginForm'

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      {/* Left — brand panel */}
      <div className="relative hidden w-[46%] shrink-0 flex-col justify-between overflow-hidden border-r border-border bg-background-elevated p-10 lg:flex">
        <div className="bg-glow pointer-events-none absolute inset-0" />

        <div className="relative flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent shadow-[0_0_20px_-4px_rgba(16,185,129,0.7)]">
            <Sparkles className="h-4.5 w-4.5 text-black" strokeWidth={2.25} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-foreground">
            TheCraftSync
          </span>
        </div>

        <div className="relative max-w-md space-y-8">
          <blockquote className="space-y-4">
            <p className="text-2xl font-medium leading-snug tracking-tight text-foreground">
              &ldquo;Our first-response time dropped from 40 minutes to under 3. This is the first
              helpdesk our agents actually enjoy using.&rdquo;
            </p>
            <footer className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-soft text-xs font-semibold text-violet">
                RK
              </span>
              <div className="text-sm">
                <p className="font-medium text-foreground">Riya Kapoor</p>
                <p className="text-muted">Head of Support, Northwind</p>
              </div>
            </footer>
          </blockquote>

          <div className="grid grid-cols-3 gap-4 border-t border-border pt-6">
            <div className="flex items-start gap-2.5">
              <Zap className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" />
              <p className="text-xs leading-snug text-muted">Realtime updates, zero refresh</p>
            </div>
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" />
              <p className="text-xs leading-snug text-muted">SSO, 2FA & audit trails</p>
            </div>
            <div className="flex items-start gap-2.5">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" />
              <p className="text-xs leading-snug text-muted">Built for busy support teams</p>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-muted">© 2026 TheCraftSync. All rights reserved.</p>
      </div>

      {/* Right — form */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
              <Sparkles className="h-4.5 w-4.5 text-black" strokeWidth={2.25} />
            </div>
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              TheCraftSync
            </span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted">Sign in to your workspace to continue</p>

          <div className="mt-7">
            <LoginForm />
          </div>

          <p className="mt-6 text-center text-sm text-muted">
            New to TheCraftSync?{' '}
            <Link href="/register" className="font-medium text-accent-strong hover:text-accent">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
