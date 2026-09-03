import * as React from 'react'

import { cn } from '@/lib/utils'

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'destructive'
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        variant === 'destructive'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-border bg-muted text-foreground',
        className
      )}
      {...props}
    />
  )
)
Alert.displayName = 'Alert'

export { Alert }
