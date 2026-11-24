import {
  BarChart3,
  Bot,
  Brain,
  Briefcase,
  MailCheck,
  Puzzle,
  Search,
  Settings,
  Shield,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { HelpKey } from "@/lib/help";

export type NavItem = {
  to: string;
  label: string;
  /** A shorter name for the phone's tab bar. */
  short?: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** Its ⓘ (spec 019): shown beside the title in the phone's top bar. */
  help?: HelpKey;
};

/** Every page, in the desktop sidebar's order. */
export const NAV: NavItem[] = [
  { to: "/search", label: "Find Jobs", icon: Search },
  { to: "/jobs", label: "My Jobs", icon: Briefcase },
  { to: "/matches", label: "Matches", icon: Sparkles, help: "matches" },
  { to: "/email-updates", label: "Email Updates", short: "Email", icon: MailCheck, help: "emailUpdates" },
  { to: "/analytics", label: "Analytics", icon: BarChart3, help: "analytics" },
  { to: "/ai-apply", label: "AI Apply", icon: Bot, help: "aiApply" },
  { to: "/autofill", label: "Autofill memory", short: "Memory", icon: Brain, help: "autofill" },
  { to: "/job-catcher", label: "Job Catcher", icon: Puzzle, help: "jobCatcher" },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/admin", label: "Admin", icon: Shield, adminOnly: true },
];

// The phone's bottom bar holds the three things done on a phone (check your
// jobs, check your email updates, search) plus More for everything else. Four
// slots keep each one a wide thumb target.
const TAB_ORDER = ["/jobs", "/email-updates", "/search"];

export const TABS = TAB_ORDER.map((to) => NAV.find((item) => item.to === to)!);
export const MORE = NAV.filter((item) => !TAB_ORDER.includes(item.to));

/** The pages this user can open. */
export function allowed(items: NavItem[], isAdmin: boolean): NavItem[] {
  return items.filter((item) => !item.adminOnly || isAdmin);
}

/** The page a path belongs to ("/jobs/123" is My Jobs). */
export function pageFor(pathname: string): NavItem | undefined {
  return NAV.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
}

export async function signOut() {
  await createClient().auth.signOut();
  window.location.href = "/login";
}
