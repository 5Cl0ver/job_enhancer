/**
 * The phone's frame: a slim title bar at the top and a four-slot tab bar at the
 * bottom (My Jobs · Email · Find Jobs · More). More slides up a sheet with
 * every other page and Sign out. All of it is hidden from 768px up, where the
 * sidebar takes over.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, LogOut, Menu } from "lucide-react";
import { MORE, TABS, allowed, pageFor, signOut } from "@/components/layout/nav";
import { InfoBubble } from "@/components/common/InfoBubble";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ACTIONS_SLOT = "topbar-actions";

/** A count on a nav item; nothing at zero. */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold leading-5 text-primary-foreground",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function TopBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const page = pageFor(pathname);
  // One level down (a job's own page): show a way back.
  const inner = !!page && pathname !== page.to;
  // Back to wherever you came from (My Jobs, Matches, an email). Opened
  // straight from a link there is nowhere to go back to, so go up to the list.
  const back = () => {
    const cameFromInside = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
    if (cameFromInside) navigate(-1);
    else if (page) navigate(page.to, { replace: true });
  };

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      <div className="flex h-12 items-center gap-1 px-4">
        {inner && (
          <button
            type="button"
            aria-label="Back"
            onClick={back}
            className="-ml-3 flex h-11 w-11 items-center justify-center rounded-md active:bg-accent"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <p className="truncate text-xl font-semibold tracking-tight">
          {/* A job can be opened from My Jobs, Find Jobs, Matches or an email,
              so its page isn't titled after any one of them. */}
          {inner ? "Job" : (page?.label ?? "Job Enhancer")}
        </p>
        {!inner && page?.help && <InfoBubble topic={page.help} />}
        {/* The current page's own buttons land here (TopBarActions). */}
        <div id={ACTIONS_SLOT} className="-mr-2 ml-auto flex shrink-0 items-center gap-1" />
      </div>
    </header>
  );
}

/** Put a page's buttons in the phone's top bar. Renders nothing on desktop,
 * where the bar isn't shown and pages keep their buttons in their own header. */
export function TopBarActions({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(ACTIONS_SLOT)), []);
  return slot ? createPortal(children, slot) : null;
}

const TAB =
  "group relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition-colors";
// The pill behind a tab's icon: filled for the current tab, a flash when pressed.
const PILL =
  "relative flex h-7 w-14 items-center justify-center rounded-full transition-colors group-active:bg-accent";

export function TabBar({
  emailCount,
  scoutCount = 0,
  isAdmin,
}: {
  emailCount: number;
  /** Claude Scout's picks waiting on Find Jobs. */
  scoutCount?: number;
  isAdmin: boolean;
}) {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const more = allowed(MORE, isAdmin);
  const onMorePage = more.some((item) => item.to === pageFor(pathname)?.to);

  return (
    <>
      {/* `pb-[env(safe-area-inset-bottom)]` keeps the bar above the iOS home
          indicator / Android gesture bar. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {TABS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(TAB, isActive ? "text-primary" : "text-muted-foreground")
            }
          >
            {({ isActive }) => (
              <>
                <span className={cn(PILL, isActive && "bg-primary/15")}>
                  <item.icon className="h-5 w-5" aria-hidden />
                  {item.to === "/email-updates" && (
                    <CountBadge count={emailCount} className="absolute -top-1 right-0" />
                  )}
                  {item.to === "/search" && (
                    <CountBadge count={scoutCount} className="absolute -top-1 right-0" />
                  )}
                </span>
                <span className="truncate">{item.short ?? item.label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className={cn(TAB, onMorePage ? "text-primary" : "text-muted-foreground")}
        >
          <span className={cn(PILL, onMorePage && "bg-primary/15")}>
            <Menu className="h-5 w-5" aria-hidden />
          </span>
          <span>More</span>
        </button>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="gap-2">
          <DialogHeader>
            <DialogTitle>More</DialogTitle>
            <DialogDescription className="sr-only">Other pages and sign out</DialogDescription>
          </DialogHeader>
          <ul className="-mx-2">
            {more.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-12 items-center gap-3 rounded-md px-2 text-base font-medium active:bg-accent",
                      isActive && "text-primary",
                    )
                  }
                >
                  <item.icon className="h-5 w-5 text-muted-foreground" aria-hidden />
                  {item.label}
                </NavLink>
              </li>
            ))}
            <li className="mt-2 border-t pt-2">
              <button
                type="button"
                onClick={signOut}
                className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-base font-medium active:bg-accent"
              >
                <LogOut className="h-5 w-5 text-muted-foreground" aria-hidden />
                Sign out
              </button>
            </li>
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
