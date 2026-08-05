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

  let range: string | null = null;
  if (min && max) range = `${fmt(min)} – ${fmt(max)}`;
  else if (min) range = `${fmt(min)}+`;
  else if (max) range = `Up to ${fmt(max)}`;
  if (!range) return null;

  return period === "hourly" ? `${range} /hr` : range;
}
