import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Search, Store } from 'lucide-react'

import { apiFetch, ApiRequestError } from '@/lib/api'
import { Wordmark } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'
import { Alert } from '@/components/ui/alert'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

interface PublicBusinessSummary {
  id: string
  name: string
  slug: string
  serviceCount: number
}

/** A settled fetch result, tagged with the query it belongs to. */
interface DirectoryResult {
  query: string
  /** `null` means this query errored (message in `errorMsg`). */
  items: PublicBusinessSummary[] | null
}

/**
 * Public, unauthenticated business directory — `/businesses`. The
 * customer half of the landing page's two-audience split: browse
 * businesses taking bookings, then open one's existing public booking
 * page (`/b/:slug`). No account, no slug to type by hand.
 */
export function BusinessDirectoryPage() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [result, setResult] = useState<DirectoryResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Debounce so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  // Fetch whenever the debounced query changes. All state updates happen
  // in the promise callbacks (never synchronously in the effect body).
  useEffect(() => {
    let cancelled = false
    const qs = debouncedQuery ? `?q=${encodeURIComponent(debouncedQuery)}` : ''

    apiFetch<PublicBusinessSummary[]>(`/businesses${qs}`)
      .then((items) => {
        if (cancelled) return
        setResult({ query: debouncedQuery, items })
        setErrorMsg(null)
      })
      .catch((err) => {
        if (cancelled) return
        setResult({ query: debouncedQuery, items: null })
        setErrorMsg(
          err instanceof ApiRequestError
            ? err.message
            : 'Could not load businesses. Please try again.',
        )
      })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  // Derived, not stored: loading is simply "no settled result for the
  // query we're currently showing".
  const settled = result?.query === debouncedQuery
  const businesses = settled ? result?.items ?? null : null
  const loading = !settled

  return (
    <div className="min-h-screen bg-hero-grid">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Wordmark />
          </Link>
          <ThemeToggle />
        </div>

        <div className="mt-8">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" />
            Back
          </Link>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            Find a business
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Browse businesses taking bookings, then pick a time. No account
            needed.
          </p>
        </div>

        <div className="relative mt-6">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            className="pl-9"
            placeholder="Search by name…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search businesses by name"
          />
        </div>

        <div className="mt-6">
          {loading ? (
            <ul className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <li key={index} aria-hidden="true">
                  <Skeleton className="h-[4.75rem] w-full rounded-lg" />
                </li>
              ))}
            </ul>
          ) : businesses === null ? (
            <Alert variant="destructive">{errorMsg}</Alert>
          ) : businesses.length === 0 ? (
            <EmptyState
              icon={Store}
              title={
                debouncedQuery ? 'No matching businesses' : 'No businesses yet'
              }
              description={
                debouncedQuery
                  ? `Nothing matched “${debouncedQuery}”. Try a different name.`
                  : 'No businesses have opened up booking yet. Check back soon.'
              }
            />
          ) : (
            <ul className="space-y-3">
              {businesses.map((business) => (
                <li key={business.id}>
                  <Link
                    to={`/b/${business.slug}`}
                    className="group flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4 shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">
                        {business.name}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {business.serviceCount}{' '}
                        {business.serviceCount === 1 ? 'service' : 'services'}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
                      Book
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
