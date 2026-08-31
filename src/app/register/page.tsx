import Link from 'next/link'
import { Sparkles, ShieldCheck, Clock, Users } from 'lucide-react'
import { RegisterForm } from '@/components/auth/RegisterForm'

export default function RegisterPage() {
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

        <div className="relative max-w-md space-y-6">
          <p className="text-2xl font-medium leading-snug tracking-tight text-foreground">
            Request access as a Manager or Agent — an admin reviews every request before you can
            sign in.
          </p>

          <div className="grid grid-cols-3 gap-4 border-t border-border pt-6">
            <div className="flex items-start gap-2.5">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" />
              <p className="text-xs leading-snug text-muted">Reviewed by an admin, not instant</p>
            </div>
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" />
              <p className="text-xs leading-snug text-muted">No self-service Admin accounts</p>
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

          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Request an account
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Fill in your details — an admin will review and approve your access.
          </p>

          <div className="mt-7">
            <RegisterForm />
          </div>

          <p className="mt-6 text-center text-sm text-muted">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-accent-strong hover:text-accent">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
