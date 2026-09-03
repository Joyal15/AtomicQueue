import { NavLink, Outlet, useNavigate } from 'react-router-dom'

import { useAuth } from '@/lib/use-auth'
import { Button } from '@/components/ui/button'

const navItems = [
  { to: '/dashboard', label: 'Overview', end: true },
  { to: '/dashboard/services', label: 'Services', end: false },
  { to: '/dashboard/staff', label: 'Staff', end: false },
]

/**
 * Authenticated shell: business name in the header, nav to the
 * dashboard sub-pages, sign-out. Every /dashboard/* route renders
 * inside this via <Outlet />.
 */
export function DashboardLayout() {
  const { business, user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              QueueLess++
            </p>
            <h1 className="text-lg font-semibold">
              {business?.name ?? 'Your business'}
            </h1>
          </div>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-secondary-foreground'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {user && (
              <span className="text-sm text-muted-foreground">
                {user.name} · {user.role}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
