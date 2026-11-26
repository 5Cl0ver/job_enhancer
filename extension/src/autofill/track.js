// Auto-track: when the user submits an application on an applicant system,
// tell the app so the matching saved job moves to Applied by itself. On
// Workday a job never saved is saved from the page first (spec 034): the user
// did apply, so it's tracked. Nothing is ever submitted for the user.

const WORKDAY_HOST = /\.(myworkdayjobs|myworkdaysite)\.com$/i;

/** Which applicant system rents this page its form (for reading the job). */
export function detectAts(url) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (/(^|\.)greenhouse\.io$/i.test(host)) return "greenhouse";
  if (/(^|\.)lever\.co$/i.test(host)) return "lever";
  if (WORKDAY_HOST.test(host)) return "workday";
  return null;
}

const words = (s) =>
  decodeURIComponent(String(s || ""))
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A Workday address, read (spec 034): the company's Workday site name
 * ("northwind" in northwind.wd5.myworkdayjobs.com, or /recruiting/<name>/ on
 * myworkdaysite.com), and for a job's own pages the posting's address (the
 * apply steps' "/apply…" taken off), its title and place from the address
 * (…/job/Portland-OR/Applications-Developer-II_JR-1001). Null off Workday.
 * @returns {{tenant: string, posting: string, title: string, location: string, apply: boolean} | null}
 */
export function workdayAddress(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!WORKDAY_HOST.test(u.hostname)) return null;
  const shared = /myworkdaysite\.com$/i.test(u.hostname);
  const tenant = (shared ? /\/recruiting\/([^/]+)/i.exec(u.pathname)?.[1] : u.hostname.split(".")[0]) || "";
  const path = u.pathname.replace(/\/+$/, "");
  const apply = /\/(apply|application)(\/|$)/i.test(path);
  const jobPath = path.replace(/\/(apply|application)(\/.*)?$/i, "");
  const m = /\/job\/(.+)$/i.exec(jobPath);
  if (!m) return { tenant: tenant === "www" ? "" : tenant, posting: "", title: "", location: "", apply };
  const parts = m[1].split("/").filter(Boolean);
  const last = parts.pop() || "";
  // "Applications-Developer-II_JR-1001": the title, then the requisition id.
  const title = words(last.includes("_") ? last.slice(0, last.lastIndexOf("_")) : last);
  // "Portland-OR" → "Portland, OR"; "Remote-USA" → "Remote USA".
  const place = parts.length ? decodeURIComponent(parts[parts.length - 1]) : "";
  const location = /-[A-Z]{2}$/.test(place) ? `${words(place.slice(0, -3))}, ${place.slice(-2)}` : words(place);
  return { tenant: tenant === "www" ? "" : tenant, posting: `${u.origin}${jobPath}`, title, location, apply };
}

/** A Workday site's name as a company: "northwind" → "Northwind". */
export function tenantCompany(tenant) {
  const t = words(tenant).replace(/\d+$/, "").trim();
  return t ? t.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : "";
}

/** The job being applied to, read off the page. */
export function jobInfo(doc, ats, loc) {
  if (ats === "workday") {
    const where = workdayAddress(loc.href) || { tenant: "", posting: "", title: "", location: "" };
    const header = doc.querySelector('[data-automation-id="jobPostingHeader"]')?.textContent?.trim() || "";
    const title =
      header ||
      where.title ||
      doc.querySelector("h1")?.textContent?.trim() ||
      (doc.title || "")
        .split(/[|–-]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .pop() ||
      "";
    return { title, company: tenantCompany(where.tenant), url: where.posting, location: where.location };
  }
  if (ats === "greenhouse") {
    const m = /job application for (.+) at (.+)/i.exec(doc.title);
    return {
      title: doc.querySelector(".app-title, h1")?.textContent?.trim() || m?.[1] || "",
      company: doc.querySelector(".company-name")?.textContent?.replace(/^\s*at\s+/i, "").trim() || m?.[2] || "",
    };
  }
  // Lever's tab title, "<Company> - <Title>" (also the fallback elsewhere: the
  // app only moves a saved job whose title and company match).
  const [company, ...rest] = (doc.title || "").split(" - ");
  return {
    title: doc.querySelector(".posting-headline h2")?.textContent?.trim() || rest.join(" - ").trim(),
    company: (company || "").trim(),
  };
}

/**
 * Call `onSubmit(job)` once when the application is submitted: a form submit,
 * or on Workday the final "Submit" button (a single-page app). On Workday the
 * job carries `create`: what to save it as when it isn't saved yet.
 */
export function watchForSubmit({ doc = document, loc = location, isCurrent, onSubmit }) {
  const ats = detectAts(loc.href);
  let sent = false;
  const fire = () => {
    if (sent || !isCurrent()) return;
    const job = jobInfo(doc, ats, loc);
    if (!job.title) return;
    sent = true;
    // Only on Workday (spec 034): the job is surely the page's own, read
    // from its address. Never on any other site's form.
    if (ats === "workday" && job.url && job.company) {
      job.create = { url: job.url, title: job.title, company: job.company, location: job.location || "Not specified" };
    }
    onSubmit(job);
  };
  doc.addEventListener("submit", fire, true);
  if (ats === "workday") {
    doc.addEventListener(
      "click",
      (e) => {
        const b = e.target?.closest?.('button, [role="button"]');
        const label = (b?.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (label === "submit") fire();
      },
      true,
    );
  }
}
