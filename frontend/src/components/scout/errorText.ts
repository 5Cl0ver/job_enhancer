import { ApiError } from "@/lib/api";

/** The server's own message for a failed request (its JSON `detail`), else a fallback. */
export function errorText(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback;
  try {
    const detail = (JSON.parse(e.message) as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  } catch {
    // not JSON: the message is already readable
  }
  return e.message || fallback;
}
