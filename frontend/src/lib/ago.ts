/** "40 s ago", "3 min ago": short enough for a phone (spec 040). */
export function ago(at: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  return `${Math.round(s / 60)} min ago`;
}
