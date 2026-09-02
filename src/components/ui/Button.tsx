import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { forwardRef } from 'react'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        // Deliberately inverted, not `text-foreground`: dark mode wants near-black text, light
        // mode wants near-white -- the *opposite* of what --foreground gives (that's tuned for
        // body text against the page background, not this). --background already holds exactly
        // those two values (near-black in dark, near-white in light), so reusing it as the text
        // colour here gets the right pairing in both themes for free.
        primary:
          'bg-accent text-background hover:bg-accent-strong shadow-[0_0_0_1px_rgba(16,185,129,0.3),0_8px_20px_-6px_rgba(16,185,129,0.45)]',
        secondary:
          'bg-overlay-strong text-foreground border border-border-strong hover:bg-overlay-strong',
        ghost: 'text-muted-strong hover:bg-overlay-strong hover:text-foreground',
        danger: 'bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4',
        lg: 'h-11 px-5 text-[15px]',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    )
  },
)
Button.displayName = 'Button'
