import { NavLink, Outlet } from "react-router-dom";
import { LogOut } from "lucide-react";
import { RequireAuth } from "@/routes/RequireAuth";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { CountBadge, TabBar, TopBar } from "@/components/layout/PhoneNav";
import { NAV, allowed, signOut } from "@/components/layout/nav";
import { useAttention } from "@/hooks/useAttention";
import { useProfile } from "@/hooks/useProfile";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";

// The persistent app frame. On a desktop that's a sidebar beside the page. On a
// phone the sidebar would eat over half the screen, so the frame becomes a slim
// title bar and a bottom tab bar instead (components/layout/PhoneNav).
export function DashboardLayout() {
  return (
    <RequireAuth>
      <Frame />
    </RequireAuth>
  );
}

/** The frame itself. Inside RequireAuth, so its requests only go out for a
 * signed-in user. */
function Frame() {
  // Live-sync saved jobs across the app, the extension, and other tabs.
  useRealtimeSync();
  const { data: profile } = useProfile();
  const { data: attention } = useAttention();
  const isAdmin = profile?.role === "admin";
  const emailCount = attention?.email_review ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <OfflineBanner />
      <div className="flex min-h-0 flex-1">
        {/* Desktop sidebar — hidden on phones in favour of the bars. */}
        <aside className="hidden w-56 shrink-0 flex-col border-r bg-card p-4 md:flex">
          <div className="mb-6 px-2 text-lg font-semibold">Job Enhancer</div>
          <nav className="flex flex-col gap-1">
            {allowed(NAV, isAdmin).map((item) => (
              // NavLink is React Router's <Link> that knows if it's the active
              // route — we use that to highlight the current page.
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`
                }
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1 truncate">{item.label}</span>
                {item.to === "/email-updates" && (
                  <CountBadge
                    count={emailCount}
                    className="bg-background text-foreground ring-1 ring-border"
                  />
                )}
              </NavLink>
            ))}
          </nav>
          <button
            onClick={signOut}
            className="mt-auto flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          {/* On a phone: one 16px gutter (pages add none of their own), and
              bottom padding that clears the fixed tab bar. */}
          <main className="min-w-0 flex-1 px-4 pb-24 pt-3 md:p-8">
            {/* Whichever child route matches renders here */}
            <Outlet />
          </main>
        </div>
      </div>

      <TabBar emailCount={emailCount} isAdmin={isAdmin} />
    </div>
  );
}
