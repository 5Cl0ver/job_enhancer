// What "Read the page again" saw, said plainly (spec 034). Pure: unit-tested
// in test/workday-034.spec.js.

const boxes = (n: number) => `${n} box${n === 1 ? "" : "es"}`;

/**
 * A sign-up page, the boxes found, a sign-in page's boxes (never "no boxes"
 * when there are some), or truly none.
 */
export function readAgainSays(
  res: { ok?: boolean; form?: boolean; signup?: boolean; fields?: number; seen?: number; password?: boolean } | null,
): string {
  if (!res?.ok) return "Chrome doesn't let extensions read this page.";
  if (res.signup) return "Sign-up page: Job Catcher fills your email; passwords are yours.";
  if (res.form) return `Read again: found ${boxes(res.fields || res.seen || 0)}.`;
  const seen = res.seen || 0;
  if (seen && res.password) return `Read again: a sign-in page (${boxes(seen)}). Job Catcher never fills passwords: sign in, then press Autofill.`;
  if (seen) return `Read again: found ${boxes(seen)}, but not a form to fill. Press Autofill to try anyway.`;
  return "Read again: no boxes found.";
}
