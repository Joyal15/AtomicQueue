import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CalendarClock,
  Lock,
  Radio,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react'

import { useAuth } from '@/lib/use-auth'
import { Wordmark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'

const features = [
  {
    icon: Lock,
    title: 'No double-bookings, ever',
    body: 'Every claim is a single atomic conditional write. Two people tapping the same slot — one wins, the other is offered the waitlist instantly.',
  },
  {
    icon: Radio,
    title: 'Live availability',
    body: 'Slots update over WebSockets the moment they change. No refreshing, no stale times, no "sorry, that just went".',
  },
  {
    icon: Zap,
    title: 'Held while you check out',
    body: 'Picking a time places a short Redis-backed hold with a visible countdown, so a slow form never costs you the appointment.',
  },
  {
    icon: Users,
    title: 'Staff, resources & walk-ins',
    body: 'Book people or rooms and equipment with real capacity. Front desk can confirm a walk-in in two taps, no hold step.',
  },
  {
    icon: CalendarClock,
    title: 'Reschedule & cancel, cleanly',
    body: 'A reschedule is one transaction — an atomic two-slot swap. Cancellations release the slot and notify the next person waiting.',
  },
  {
    icon: Sparkles,
    title: 'AI no-show risk',
    body: 'A background job reads booking history and surfaces a plain-language risk note to staff. Purely informational — it never gates a booking.',
  },
]

export function LandingPage() {
  const { status } = useAuth()
  const isAuthed = status === 'authenticated'
  const businessTo = isAuthed ? '/dashboard' : '/signup'
  const businessLabel = isAuthed ? 'Go to dashboard' : 'Create your business'

  return (
    <div className="min-h-screen bg-hero-grid">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Wordmark />
        <nav className="flex items-center gap-2">
          <ThemeToggle />
          {isAuthed ? (
            <Button asChild size="sm">
              <Link to="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <Button asChild variant="ghost" size="sm">
              <Link to="/login">Business log in</Link>
            </Button>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-6 pb-14 pt-16 text-center sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
            <span className="size-1.5 rounded-full bg-success" />
            Live availability, updated as you watch
          </span>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Book an appointment in
            <span className="whitespace-nowrap text-primary"> under a minute</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            Find a business, pick an open time, and confirm with just your name
            and a way to reach you. No account, no app — and the slot is held
            for you while you fill it in.
          </p>

          <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3">
            <Button asChild size="xl" className="w-full">
              <Link to="/businesses">
                Find a business
                <ArrowRight />
              </Link>
            </Button>
            <p className="text-sm text-muted-foreground">
              Already have a booking?{' '}
              <Link
                to="/manage"
                className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Manage or reschedule it
              </Link>
            </p>
          </div>

          <div className="mx-auto mt-12 max-w-md border-t border-border/70 pt-6">
            <p className="text-sm text-muted-foreground">
              Running a business?{' '}
              <Link
                to={businessTo}
                className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {businessLabel}
              </Link>{' '}
              to manage appointments, staff and availability.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="grid gap-8 border-t border-border pt-14 md:grid-cols-[16rem_1fr] md:gap-12">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Why book here
              </p>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                The time you pick is the time you get.
              </h2>
            </div>

            <dl className="divide-y divide-border">
              {features.map(({ icon: Icon, title, body }) => (
                <div
                  key={title}
                  className="grid gap-1.5 py-5 first:pt-0 sm:grid-cols-[11rem_1fr] sm:gap-6"
                >
                  <dt className="flex items-start gap-2.5 text-sm font-semibold text-foreground">
                    <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{title}</span>
                  </dt>
                  <dd className="text-sm leading-relaxed text-muted-foreground">
                    {body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-6 text-xs text-muted-foreground sm:flex-row">
          <Wordmark showGlyph={false} />
          <p>Demo project · atomic holds · Socket.IO · BullMQ · Gemini</p>
        </div>
      </footer>
    </div>
  )
}
