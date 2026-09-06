import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'

import { Wordmark } from '@/components/brand'

const points = [
  'Atomic holds — no double-bookings under load',
  'Live availability over WebSockets',
  'Automatic waitlist when a slot frees up',
]

/**
 * Two-column auth layout: a branded panel on the left (desktop only)
 * and the form card on the right. Used by both login and signup.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <Link to="/" className="inline-flex">
          <Wordmark className="text-primary-foreground [&_span]:text-primary-foreground" />
        </Link>
        <div>
          <p className="text-2xl font-semibold leading-snug">
            The booking engine that treats a slot like a seat on a plane.
          </p>
          <ul className="mt-8 space-y-3">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
                  <Check className="size-3" />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-primary-foreground/70">
          QueueLess++ — demo project
        </p>
      </div>

      <div className="flex items-center justify-center bg-hero-grid px-4 py-12 lg:bg-none lg:bg-background">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-8 inline-flex lg:hidden">
            <Wordmark />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>

          <div className="mt-8">{children}</div>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {footer}
          </div>
        </div>
      </div>
    </div>
  )
}
