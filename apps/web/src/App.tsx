import { NavLink, Route, Routes } from "react-router-dom";
import type { User } from "@queueless/shared-types";


const sampleUser: User = {
  id: "tenant-admin",
  role: "owner",
};

function App() {

  
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold">QueueLess++</h1>
            
          </div>

          <nav className="flex items-center gap-4 text-sm font-medium">
            <NavLink
              to="/dashboard"
              className={({ isActive }) =>
                isActive ? "text-slate-900" : "text-slate-600"
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                isActive ? "text-slate-900" : "text-slate-600"
              }
            >
              Admin
            </NavLink>
            <NavLink
              to="/acme-book"
              className={({ isActive }) =>
                isActive ? "text-slate-900" : "text-slate-600"
              }
            >
              Bookings
            </NavLink>
          </nav>

          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
            {sampleUser.role}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <Routes>
          <Route
            path="/dashboard"
            element={
              <Placeholder
                title="Dashboard"
                description="Main operating dashboard for the tenant."
              />
            }
          />
          <Route
            path="/admin"
            element={
              <Placeholder
                title="Admin"
                description="Administrative controls and settings."
              />
            }
          />
          <Route
            path="/:tenantSlug/book"
            element={
              <Placeholder
                title="Booking Flow"
                description="Public booking experience for a tenant."
              />
            }
          />
          <Route
            path="*"
            element={
              <Placeholder
                title="Home"
                description="Route shell ready for the next feature work."
              />
            }
          />
        </Routes>
      </main>
    </div>
  );
}

function Placeholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <p className="mb-2 text-sm font-medium uppercase tracking-[0.2em] text-sky-600">
        Tenant shell
      </p>
      <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
      <p className="mt-3 max-w-xl text-slate-600">{description}</p>
    </section>
  );
}

export default App;
