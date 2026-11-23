// Auto-track: when the user submits an application on an applicant system,
// tell the app so the matching saved job moves to Applied by itself.
// (Moved unchanged from the old autofill.entry.js.)

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
  if (/\.myworkdayjobs\.com$/i.test(host)) return "workday";
  return null;
}

/** The job being applied to, read off the page. */
export function jobInfo(doc, ats, loc) {
  if (ats === "workday") {
    const header = doc.querySelector('[data-automation-id="jobPostingHeader"], h1')?.textContent?.trim() || "";
    const sub = (loc.hostname.split(".")[0] || "").trim();
    const company = sub && sub !== "www" ? sub.replace(/[-_]+/g, " ") : "";
    const title =
      header ||
      (doc.title || "")
        .split(/[|–-]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .pop() ||
      "";
    return { title, company };
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
 * or on Workday the final "Submit" button (a single-page app).
 */
export function watchForSubmit({ doc = document, loc = location, isCurrent, onSubmit }) {
  const ats = detectAts(loc.href);
  let sent = false;
  const fire = () => {
    if (sent || !isCurrent()) return;
    const job = jobInfo(doc, ats, loc);
    if (!job.title) return;
    sent = true;
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
