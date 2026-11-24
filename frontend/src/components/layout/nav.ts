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

export type NavItem = {
  to: string;
  label: string;
  /** A shorter name for the phone's tab bar. */
  short?: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

/** Every page, in the desktop sidebar's order. */
export const NAV: NavItem[] = [
  { to: "/search", label: "Find Jobs", icon: Search },
  { to: "/jobs", label: "My Jobs", icon: Briefcase },
  { to: "/matches", label: "Matches", icon: Sparkles },
  { to: "/email-updates", label: "Email Updates", short: "Email", icon: MailCheck },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/ai-apply", label: "AI Apply", icon: Bot },
  { to: "/autofill", label: "Autofill memory", short: "Memory", icon: Brain },
  { to: "/job-catcher", label: "Job Catcher", icon: Puzzle },
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
