import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * "$80,299 – $104,389" (yearly) or "$50 – $100 /hr" (hourly).
 * Hourly listings must be labeled — a bare "$50" reads as an annual salary.
 */
export function formatSalary(
  min?: number | null,
  max?: number | null,
  currency?: string | null,
  period?: "yearly" | "hourly" | null,
): string | null {
  const curr = currency ?? "USD";
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: curr,
      maximumFractionDigits: 0,
    }).format(n);

  // Ignore non-positive sentinels (Indeed's -1 "no max") so stale rows that
  // still hold one don't render "$80,000 – -$1".
  const lo = min && min > 0 ? min : null;
  const hi = max && max > 0 ? max : null;

  let range: string | null = null;
  if (lo && hi) range = `${fmt(lo)} – ${fmt(hi)}`;
  else if (lo) range = `${fmt(lo)}+`;
  else if (hi) range = `Up to ${fmt(hi)}`;
  if (!range) return null;

  return period === "hourly" ? `${range} /hr` : range;
}
