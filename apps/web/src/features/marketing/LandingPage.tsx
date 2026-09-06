import { Link } from 'react-router-dom'
import {
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
  const primaryTo = status === 'authenticated' ? '/dashboard' : '/signup'
  const primaryLabel =
    status === 'authenticated' ? 'Go to dashboard' : 'Create your business'

  return (
    <div className="min-h-screen bg-hero-grid">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Wordmark />
        <nav className="flex items-center gap-2">
          {status === 'authenticated' ? (
            <Button asChild size="sm">
              <Link to="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link to="/login">Log in</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/signup">Sign up</Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-6 pb-16 pt-16 text-center sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
            <span className="size-1.5 rounded-full bg-success" />
            Concurrency-safe booking engine
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Appointment booking that never
            <span className="text-primary"> double-books</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            QueueLess++ gives small businesses a real-time booking page with
            atomic holds, an automatic waitlist, and a clean reschedule /
            cancel flow — built on the same conditional-write discipline a
            payments system would use.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="xl">
              <Link to={primaryTo}>{primaryLabel}</Link>
            </Button>
            <Button asChild size="xl" variant="outline">
              <Link to="/login">I already have an account</Link>
            </Button>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-lg border border-border/70 bg-card p-5 shadow-sm"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-3.5 text-sm font-semibold text-foreground">
                  {title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
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
