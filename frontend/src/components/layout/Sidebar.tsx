"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bookmark,
  Briefcase,
  Inbox,
  KanbanSquare,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useProfile } from "@/hooks/useProfile";
import { useNewMatches } from "@/hooks/useSavedSearches";
import { Badge } from "@/components/ui/badge";

const NAV_ITEMS = [
  { href: "/search", label: "Search", icon: Search },
  { href: "/matches", label: "New Matches", icon: Inbox },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/tracker", label: "Tracker", icon: KanbanSquare },
  { href: "/ai-apply", label: "AI Apply", icon: Sparkles },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: profile } = useProfile();
  const { data: matches } = useNewMatches();
  const newCount = matches?.total_new ?? 0;

  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r bg-background md:flex">
      <Link
        href="/search"
        className="flex items-center gap-2 px-5 py-4 font-semibold"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Briefcase className="h-4 w-4" aria-hidden />
        </span>
        Job Enhancer
      </Link>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2" aria-label="Main">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
              {href === "/matches" && newCount > 0 && (
                <Badge variant="secondary" className="ml-auto">
                  {newCount > 99 ? "99+" : newCount}
                </Badge>
              )}
            </Link>
          );
        })}

        {profile?.role === "admin" && (
          <Link
            href="/admin"
            aria-current={pathname.startsWith("/admin") ? "page" : undefined}
            className={cn(
              "mt-auto flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith("/admin")
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Admin
          </Link>
        )}
      </nav>
    </aside>
  );
}
