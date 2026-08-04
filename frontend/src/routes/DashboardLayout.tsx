import { NavLink, Outlet } from "react-router-dom";
import { LogOut } from "lucide-react";
import { RequireAuth } from "@/routes/RequireAuth";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";

// The persistent app frame: a sidebar that stays put while the main area
// (the <Outlet/>) swaps between pages as you navigate. This replaces the
// Next.js file `app/(dashboard)/layout.tsx`.
const NAV = [
  { to: "/search", label: "Search" },
  { to: "/saved", label: "Saved" },
  { to: "/tracker", label: "Tracker" },
  { to: "/matches", label: "Matches" },
  { to: "/analytics", label: "Analytics" },
  { to: "/ai-apply", label: "AI Apply" },
  { to: "/settings", label: "Settings" },
  { to: "/admin", label: "Admin" },
];

export function DashboardLayout() {
  // Live-sync saved jobs across the app, the extension, and other tabs.
  useRealtimeSync();

  const handleSignOut = async () => {
    await createClient().auth.signOut();
    window.location.href = "/login";
  };

  return (
    <RequireAuth>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <OfflineBanner />
        <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-r bg-card p-4">
          <div className="mb-6 px-2 text-lg font-semibold">Job Enhancer</div>
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => (
              // NavLink is React Router's <Link> that knows if it's the active
              // route — we use that to highlight the current page.
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <button
            onClick={handleSignOut}
            className="mt-auto flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </aside>

        <main className="min-w-0 flex-1 p-8">
          {/* Whichever child route matches renders here */}
          <Outlet />
        </main>
        </div>
      </div>
    </RequireAuth>
  );
}
