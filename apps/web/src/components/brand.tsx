import { CalendarClock } from 'lucide-react'

import { cn } from '@/lib/utils'

export function LogoGlyph({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground',
        className ?? 'size-8',
      )}
    >
      <CalendarClock className="size-[55%]" />
    </span>
  )
}

export function Wordmark({
  className,
  showGlyph = true,
}: {
  className?: string
  showGlyph?: boolean
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {showGlyph && <LogoGlyph className="size-7" />}
      <span className="text-[0.95rem] font-semibold tracking-tight">
        QueueLess<span className="text-primary">++</span>
      </span>
    </span>
  )
}
