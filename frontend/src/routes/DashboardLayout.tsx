import { NavLink, Outlet } from "react-router-dom";
import {
  LogOut,
  Search,
  Briefcase,
  Sparkles,
  BarChart3,
  Bot,
  Settings,
  Shield,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { RequireAuth } from "@/routes/RequireAuth";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { cn } from "@/lib/utils";

// The persistent app frame. On a desktop that's a sidebar beside the page; on a
// phone the sidebar would eat over half the screen, so it becomes a bottom tab
// bar instead — the pattern every native app uses, and thumb-reachable.
type NavItem = { to: string; label: string; icon: LucideIcon; primary?: boolean };

const NAV: NavItem[] = [
  { to: "/search", label: "Search", icon: Search, primary: true },
  { to: "/jobs", label: "My Jobs", icon: Briefcase, primary: true },
  { to: "/matches", label: "Matches", icon: Sparkles, primary: true },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/ai-apply", label: "AI Apply", icon: Bot, primary: true },
  { to: "/settings", label: "Settings", icon: Settings, primary: true },
  { to: "/admin", label: "Admin", icon: Shield },
];

// Five tabs is the most that stays tappable on a narrow phone. Everything the
// bar can't hold gets a row at the top of Settings — the sidebar used to be the
// only way to reach those routes, so dropping them from the bar without a
// replacement would strand them on mobile.
const MOBILE_NAV = NAV.filter((item) => item.primary);
export const MOBILE_OVERFLOW_NAV = NAV.filter((item) => !item.primary);

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
          {/* Desktop sidebar — hidden on phones in favour of the tab bar below. */}
          <aside className="hidden w-56 shrink-0 flex-col border-r bg-card p-4 md:flex">
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

          {/* Bottom padding on mobile clears the fixed tab bar so the last row of
              content isn't trapped underneath it. */}
          <main className="min-w-0 flex-1 p-4 pb-24 md:p-8 md:pb-8">
            {/* Whichever child route matches renders here */}
            <Outlet />
          </main>
        </div>

        {/* Mobile tab bar. `pb-[env(safe-area-inset-bottom)]` keeps it above the
            iOS home indicator / Android gesture bar. */}
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          {MOBILE_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  // min-h-14 keeps every tab at a comfortable touch target.
                  "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )
              }
            >
              <item.icon className="h-5 w-5" aria-hidden />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </RequireAuth>
  );
}
