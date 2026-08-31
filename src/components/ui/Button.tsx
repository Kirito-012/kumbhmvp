import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { forwardRef } from 'react'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-black hover:bg-accent-strong shadow-[0_0_0_1px_rgba(16,185,129,0.3),0_8px_20px_-6px_rgba(16,185,129,0.45)]',
        secondary:
          'bg-white/[0.06] text-foreground border border-border-strong hover:bg-white/[0.1]',
        ghost: 'text-muted-strong hover:bg-white/[0.06] hover:text-foreground',
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
