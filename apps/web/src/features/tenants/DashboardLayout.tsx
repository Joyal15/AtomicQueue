import { useEffect, useState } from 'react'
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import {
  CalendarRange,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  Menu,
  Scissors,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { useAuth } from '@/lib/use-auth'
import { cn } from '@/lib/utils'
import { Wordmark } from '@/components/brand'
import { Button } from '@/components/ui/button'

const navItems: { to: string; label: string; icon: LucideIcon; end: boolean }[] =
  [
    { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/dashboard/services', label: 'Services', icon: Scissors, end: false },
    { to: '/dashboard/staff', label: 'Staff', icon: Users, end: false },
    {
      to: '/dashboard/schedule',
      label: 'Schedule',
      icon: CalendarRange,
      end: false,
    },
    {
      to: '/dashboard/walk-in',
      label: 'Walk-in booking',
      icon: UserPlus,
      end: false,
    },
    {
      to: '/dashboard/bookings',
      label: 'Bookings',
      icon: ClipboardList,
      end: false,
    },
    {
      to: '/dashboard/waitlist',
      label: 'Waitlist',
      icon: ListChecks,
      end: false,
    },
  ]

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )
            }
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </NavLink>
        )
      })}
    </nav>
  )
}

/**
 * Authenticated shell: fixed left sidebar on desktop, a slide-over on
 * mobile. Every /dashboard/* route renders inside <main>.
 */
export function DashboardLayout() {
  const { business, user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  const sidebarBody = (
    <>
      <div className="px-3 py-4">
        <Wordmark />
      </div>
      <div className="border-y border-border px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Business
        </p>
        <p className="truncate text-sm font-semibold">
          {business?.name ?? 'Your business'}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <NavLinks onNavigate={() => setMobileOpen(false)} />
      </div>
      <div className="border-t border-border p-3">
        {user && (
          <div className="mb-2 px-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{user.name}</span>
            <span className="capitalize"> · {user.role}</span>
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleSignOut}
        >
          Sign out
        </Button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-card lg:flex">
        {sidebarBody}
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-card/95 px-4 py-3 backdrop-blur lg:hidden">
        <Wordmark />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="size-5" />
        </Button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-foreground/40 animate-overlay-in"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-card shadow-lg animate-fade-in">
            <div className="flex justify-end p-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
              >
                <X className="size-5" />
              </Button>
            </div>
            {sidebarBody}
          </div>
        </div>
      )}

      <main className="lg:pl-60">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
