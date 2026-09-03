import { Navigate, Route, Routes } from 'react-router-dom'

import { useAuth } from '@/lib/use-auth'
import { LoginPage } from '@/features/auth/LoginPage'
import { SignupPage } from '@/features/auth/SignupPage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { DashboardLayout } from '@/features/tenants/DashboardLayout'
import { DashboardOverviewPage } from '@/features/tenants/DashboardOverviewPage'
import { ServicesPage } from '@/features/tenants/ServicesPage'
import { StaffPage } from '@/features/tenants/StaffPage'

function App() {
  const { status } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<DashboardOverviewPage />} />
          <Route path="services" element={<ServicesPage />} />
          <Route path="staff" element={<StaffPage />} />
        </Route>
      </Route>

      {/* Public booking and other routes aren't built yet; fall back to login or dashboard. */}
      <Route
        path="*"
        element={
          <Navigate
            to={status === 'authenticated' ? '/dashboard' : '/login'}
            replace
          />
        }
      />
    </Routes>
  )
}

export default App
