import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Search, Store } from 'lucide-react'

import { apiFetchEnvelope, ApiRequestError } from '@/lib/api'
import { formatPrice } from '@/lib/format'
import { Wordmark } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

const PAGE_SIZE = 20

interface PublicBusinessSummary {
  id: string
  name: string
  slug: string
  serviceCount: number
  /** Up to five active service names, cheapest first — for preview chips. */
  services: string[]
  /** Lowest active-service price, or null if the business has none priced. */
  priceFrom: number | null
}

interface DirectoryPagination {
  nextCursor: string | null
  hasMore: boolean
}

interface DirectoryResponse {
  data: PublicBusinessSummary[]
  pagination: DirectoryPagination
}

interface DirectoryState {
  /** Which debounced query this state reflects. */
  query: string
  items: PublicBusinessSummary[]
  nextCursor: string | null
  hasMore: boolean
  firstPageStatus: 'loading' | 'ready' | 'error'
  firstPageError: string | null
  loadingMore: boolean
  loadMoreError: string | null
}

const INITIAL_STATE: DirectoryState = {
  query: '',
  items: [],
  nextCursor: null,
  hasMore: false,
  firstPageStatus: 'loading',
  firstPageError: null,
  loadingMore: false,
  loadMoreError: null,
}

function messageFor(err: unknown): string {
  return err instanceof ApiRequestError
    ? err.message
    : 'Could not load businesses. Please try again.'
}

function fetchDirectoryPage(params: {
  q: string
  cursor: string | null
}): Promise<DirectoryResponse> {
  const qs = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (params.q) qs.set('q', params.q)
  if (params.cursor) qs.set('cursor', params.cursor)
  return apiFetchEnvelope<DirectoryResponse>(`/businesses?${qs.toString()}`)
}

/**
 * Public, unauthenticated business directory — `/businesses`. The
 * customer half of the landing page's two-audience split: browse
 * businesses taking bookings (cursor-paginated, "Load more"), then open
 * one's existing public booking page (`/b/:slug`). No account, no slug
 * to type by hand.
 */
export function BusinessDirectoryPage() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [reloadNonce, setReloadNonce] = useState(0)
  const [state, setState] = useState<DirectoryState>(INITIAL_STATE)

  // Guards a "Load more" against a double-click / re-entry while a page
  // is already in flight. A ref, not state — it must update synchronously.
  const loadMoreLock = useRef(false)

  // Debounce so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  // First page: refetch from scratch whenever the query (or a retry)
  // changes. All state updates happen in the promise callbacks — never
  // synchronously in the effect body.
  useEffect(() => {
    let cancelled = false
    loadMoreLock.current = false

    fetchDirectoryPage({ q: debouncedQuery, cursor: null })
      .then((res) => {
        if (cancelled) return
        setState({
          query: debouncedQuery,
          items: res.data,
          nextCursor: res.pagination.nextCursor,
          hasMore: res.pagination.hasMore,
          firstPageStatus: 'ready',
          firstPageError: null,
          loadingMore: false,
          loadMoreError: null,
        })
      })
      .catch((err) => {
        if (cancelled) return
        setState({
          query: debouncedQuery,
          items: [],
          nextCursor: null,
          hasMore: false,
          firstPageStatus: 'error',
          firstPageError: messageFor(err),
          loadingMore: false,
          loadMoreError: null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery, reloadNonce])

  function loadMore() {
    if (loadMoreLock.current) return
    if (state.query !== debouncedQuery) return
    if (!state.hasMore || !state.nextCursor) return

    loadMoreLock.current = true
    const cursor = state.nextCursor
    setState((s) => ({ ...s, loadingMore: true, loadMoreError: null }))

    fetchDirectoryPage({ q: debouncedQuery, cursor })
      .then((res) => {
        setState((s) => {
          if (s.query !== debouncedQuery) return s // query changed mid-flight
          const seen = new Set(s.items.map((b) => b.id))
          const fresh = res.data.filter((b) => !seen.has(b.id))
          return {
            ...s,
            items: [...s.items, ...fresh],
            nextCursor: res.pagination.nextCursor,
            hasMore: res.pagination.hasMore,
            loadingMore: false,
          }
        })
      })
      .catch((err) => {
        setState((s) =>
          s.query !== debouncedQuery
            ? s
            : { ...s, loadingMore: false, loadMoreError: messageFor(err) },
        )
      })
      .finally(() => {
        loadMoreLock.current = false
      })
  }

  // The state may still describe the previous query while the new first
  // page is in flight — treat that as loading, and don't render stale items.
  const stale = state.query !== debouncedQuery
  const showFirstPageSkeleton = stale || state.firstPageStatus === 'loading'
  const showFirstPageError =
    !stale && state.firstPageStatus === 'error'
  const items = stale ? [] : state.items

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
            Browse businesses taking online bookings. Open one to see live
            availability and book a time — no account, no app.
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
          {showFirstPageSkeleton ? (
            <ul className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <li key={index} aria-hidden="true">
                  <Skeleton className="h-28 w-full rounded-lg" />
                </li>
              ))}
            </ul>
          ) : showFirstPageError ? (
            <div>
              <Alert variant="destructive">{state.firstPageError}</Alert>
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReloadNonce((n) => n + 1)}
                >
                  Try again
                </Button>
              </div>
            </div>
          ) : items.length === 0 ? (
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
            <>
              <p
                className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                aria-live="polite"
              >
                {debouncedQuery
                  ? `${items.length}${state.hasMore ? '+' : ''} result${items.length === 1 ? '' : 's'} for “${debouncedQuery}”`
                  : `${items.length}${state.hasMore ? '+' : ''} ${items.length === 1 ? 'business' : 'businesses'} taking bookings`}
              </p>
              <ul className="space-y-3">
                {items.map((business) => {
                  const extraServices =
                    business.serviceCount - business.services.length
                  return (
                    <li key={business.id}>
                      <Link
                        to={`/b/${business.slug}`}
                        className="group flex items-start gap-4 rounded-lg border border-border bg-card p-4 shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
                      >
                        <span
                          aria-hidden="true"
                          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg font-semibold text-primary"
                        >
                          {business.name.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-foreground">
                            {business.name}
                          </p>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {business.serviceCount}{' '}
                            {business.serviceCount === 1 ? 'service' : 'services'}
                            {business.priceFrom != null && (
                              <> · from {formatPrice(business.priceFrom)}</>
                            )}
                          </p>
                          {business.services.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {business.services.map((name) => (
                                <span
                                  key={name}
                                  className="rounded-full border border-border bg-secondary/40 px-2 py-0.5 text-xs text-muted-foreground"
                                >
                                  {name}
                                </span>
                              ))}
                              {extraServices > 0 && (
                                <span className="px-1 py-0.5 text-xs text-muted-foreground">
                                  +{extraServices} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <ChevronRight
                          className="size-5 shrink-0 self-center text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  )
                })}
              </ul>

              {(state.hasMore || state.loadMoreError) && (
                <div className="mt-4 text-center text-sm" aria-live="polite">
                  {state.loadMoreError && (
                    <Alert variant="destructive" className="mb-3 text-left">
                      {state.loadMoreError}
                    </Alert>
                  )}
                  {state.hasMore && (
                    <Button
                      variant="outline"
                      onClick={loadMore}
                      disabled={state.loadingMore}
                    >
                      {state.loadingMore ? (
                        <>
                          <Spinner />
                          Loading…
                        </>
                      ) : (
                        'Load more'
                      )}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
