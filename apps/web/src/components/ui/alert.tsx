import * as React from 'react'

import { cn } from '@/lib/utils'

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'destructive' | 'success' | 'warning'
}

const variantClasses: Record<NonNullable<AlertProps['variant']>, string> = {
  default: 'border-border bg-muted/60 text-foreground',
  destructive: 'border-destructive/20 bg-destructive/8 text-destructive',
  success: 'border-success/20 bg-success/8 text-success',
  warning: 'border-warning/25 bg-warning/10 text-warning',
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(
        'rounded-md border px-4 py-3 text-sm leading-relaxed',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  ),
)
Alert.displayName = 'Alert'

export { Alert }
