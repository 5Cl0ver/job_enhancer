/**
 * Text as a person should read it. Job titles and company names captured from
 * web pages sometimes arrive with HTML entities still in them ("R&amp;D"); this
 * turns the common ones back into characters. It never produces markup: the
 * result is shown as plain text.
 */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
};

export function plainText(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return NAMED[code.toLowerCase()] ?? whole;
    const point =
      code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff
      ? String.fromCodePoint(point)
      : whole;
  });
}
