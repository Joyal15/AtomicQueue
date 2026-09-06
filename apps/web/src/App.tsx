import { Navigate, Route, Routes } from 'react-router-dom'

import { useAuth } from '@/lib/use-auth'
import { LandingPage } from '@/features/marketing/LandingPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { SignupPage } from '@/features/auth/SignupPage'
import { AcceptInvitePage } from '@/features/auth/AcceptInvitePage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { DashboardLayout } from '@/features/tenants/DashboardLayout'
import { DashboardOverviewPage } from '@/features/tenants/DashboardOverviewPage'
import { ServicesPage } from '@/features/tenants/ServicesPage'
import { StaffPage } from '@/features/tenants/StaffPage'
import { SchedulePage } from '@/features/bookings/SchedulePage'
import { WalkInBookingPage } from '@/features/bookings/WalkInBookingPage'
import { PublicBookingPage } from '@/features/bookings/PublicBookingPage'
import { MagicLinkManagePage } from '@/features/bookings/MagicLinkManagePage'
import { StaffBookingsPage } from '@/features/bookings/StaffBookingsPage'
import { StaffWaitlistPage } from '@/features/bookings/StaffWaitlistPage'

function App() {
  const { status } = useAuth()

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/accept" element={<AcceptInvitePage />} />
      <Route path="/b/:slug" element={<PublicBookingPage />} />
      <Route path="/manage" element={<MagicLinkManagePage />} />

      <Route element={<RequireAuth />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<DashboardOverviewPage />} />
          <Route path="services" element={<ServicesPage />} />
          <Route path="staff" element={<StaffPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="walk-in" element={<WalkInBookingPage />} />
          <Route path="bookings" element={<StaffBookingsPage />} />
          <Route path="waitlist" element={<StaffWaitlistPage />} />
        </Route>
      </Route>

      <Route
        path="*"
        element={
          <Navigate
            to={status === 'authenticated' ? '/dashboard' : '/'}
            replace
          />
        }
      />
    </Routes>
  )
}

export default App
