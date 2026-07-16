"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  BarChart3,
  Bookmark,
  Inbox,
  KanbanSquare,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MOBILE_NAV = [
  { href: "/search", label: "Search", icon: Search },
  { href: "/matches", label: "New Matches", icon: Inbox },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/tracker", label: "Tracker", icon: KanbanSquare },
  { href: "/ai-apply", label: "AI Apply", icon: Sparkles },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: profile } = useProfile();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const current =
    MOBILE_NAV.find((i) => pathname.startsWith(i.href))?.label ?? "Job Enhancer";

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur">
      {/* Mobile nav */}
      <div className="flex items-center gap-2 md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation">
              <Menu className="h-5 w-5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {MOBILE_NAV.map(({ href, label, icon: Icon }) => (
              <DropdownMenuItem key={href} asChild>
                <Link href={href} className="flex items-center gap-2">
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </Link>
              </DropdownMenuItem>
            ))}
            {profile?.role === "admin" && (
              <DropdownMenuItem asChild>
                <Link href="/admin" className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  Admin
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-sm font-semibold">{current}</span>
      </div>

      <div className="hidden md:block" />

      {/* User menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
            {profile?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.image}
                alt=""
                className="h-7 w-7 rounded-full"
              />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-medium uppercase">
                {(profile?.name ?? profile?.email ?? "?").slice(0, 1)}
              </span>
            )}
            <span className="hidden max-w-40 truncate text-sm sm:inline">
              {profile?.name ?? profile?.email ?? ""}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="max-w-56 truncate">
            {profile?.email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" aria-hidden />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={signOut} className="flex items-center gap-2">
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
