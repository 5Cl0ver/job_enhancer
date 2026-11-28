// The copy of the user's details autofill fills from (spec 015, R1). Kept in
// chrome.storage.local so a press NEVER waits on the server (a free server
// sleeps): it's refreshed with a cheap version check at most once a minute, on
// sign-in, and when the side panel opens. Wiped on sign-out.
//
// Holds: profile, email, remembered answers (GET /v1/autofill/bundle), and the
// résumé file (GET /v1/ai/resumes/active/file, fetched again only when the
// résumé changes). A tailored résumé staged in Write wins over the usual one.
// The cover letter chosen for a job (spec 031) is fetched fresh for each fill.

const COPY = "je_autofill";
const RESUME = "je_resume_bytes";
const STAGED = "je_staged_bytes";
// The résumé picked for one application (spec 020): its file and its details.
const CHOSEN = "je_chosen_resume";
const CHOSEN_MS = 10 * 60_000;

/** The server percent-encodes a file's name so any name travels (RFC 6266). */
export function fileNameOf(res, fallback = "resume.pdf") {
  const raw = res.headers.get("X-Resume-Filename");
  if (!raw) return fallback;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
const REFRESH_MS = 60_000;

/**
 * @param {{api: string, token: () => Promise<string|null>, wakeFetch: Function, toB64: (buf: ArrayBuffer) => string, onFresh?: (copy: object) => Promise<void>}} deps
 */
export function createAutofillCopy({ api, token, wakeFetch, toB64, onFresh }) {
  let inFlight = null;
  // Bumped by wipe(): a refresh that started before a sign-out (or another
  // account's sign-in) must never write the old account's data back.
  let generation = 0;
  // Cover-letter fetches under way (spec 031): never kept after they land.
  const lettersInFlight = new Map();

  async function fetchResume(headers, meta, gen) {
    const { [RESUME]: cached } = await chrome.storage.local.get(RESUME);
    const stamp = `${meta.id}|${meta.updated_at}`;
    // Kept from before spec 040 (no text yet): fetched once more.
    if (cached?.stamp === stamp && cached.text !== undefined) return;
    const res = await wakeFetch(`${api}/v1/ai/resumes/active/file`, { headers });
    if (!res.ok || gen !== generation) return;
    const b64 = toB64(await res.arrayBuffer());
    // Its text too, for a "paste your résumé" box (spec 040).
    const text = meta.id ? await resumeText(headers, meta.id) : "";
    if (gen !== generation) return;
    await chrome.storage.local.set({
      [RESUME]: {
        stamp,
        b64,
        filename: fileNameOf(res, meta.filename || "resume.pdf"),
        mime: res.headers.get("Content-Type") || meta.mime || "application/pdf",
        text,
      },
    });
  }

  async function resumeText(headers, resumeId) {
    const res = await wakeFetch(`${api}/v1/autofill/resumes/${encodeURIComponent(resumeId)}/details`, { headers }).catch(() => null);
    if (!res?.ok) return "";
    const body = await res.json().catch(() => null);
    return typeof body?.text === "string" ? body.text : "";
  }

  /** Ask the server what changed (cheap when nothing did). */
  async function refresh() {
    if (inFlight) return inFlight;
    const gen = generation;
    const run = (async () => {
      const t = await token();
      if (!t) return false;
      const headers = { Authorization: `Bearer ${t}` };
      const { [COPY]: held } = await chrome.storage.local.get(COPY);
      const qs = held?.version ? `?version=${encodeURIComponent(held.version)}` : "";
      const res = await wakeFetch(`${api}/v1/autofill/bundle${qs}`, { headers });
      if (!res.ok) return false;
      const b = await res.json();
      if (gen !== generation) return false; // signed out meanwhile
      if (b.changed === false) {
        await chrome.storage.local.set({ [COPY]: { ...held, fetched_at: Date.now() } });
        // A résumé that failed to download last time: try again.
        if (held?.resume) await fetchResume(headers, held.resume, gen).catch(() => {});
        return true;
      }
      if (gen !== generation) return false;
      await chrome.storage.local.set({
        [COPY]: {
          version: b.version,
          fetched_at: Date.now(),
          email: b.email || "",
          profile: b.profile || {},
          answers: b.answers || [],
          taught: b.taught || [],
          history: b.history || null,
          resume: b.resume || null,
          promoted: !!b.promoted,
        },
      });
      if (b.resume) await fetchResume(headers, b.resume, gen).catch(() => {});
      else await chrome.storage.local.remove(RESUME);
      if (onFresh && gen === generation) {
        const { [COPY]: fresh } = await chrome.storage.local.get(COPY);
        if (fresh) await onFresh(fresh).catch(() => {});
      }
      return true;
    })()
      .catch(() => false)
      .finally(() => {
        if (inFlight === run) inFlight = null;
      });
    inFlight = run;
    return run;
  }

  /** The staged tailored résumé's PDF (cached by document). */
  async function stagedResume(t) {
    const { je_staged_resume: staged, [STAGED]: cached } = await chrome.storage.local.get(["je_staged_resume", STAGED]);
    if (!staged?.docId) return null;
    if (cached?.docId === staged.docId) return cached;
    const res = await wakeFetch(`${api}/v1/ai/documents/${staged.docId}/pdf`, {
      headers: { Authorization: `Bearer ${t}` },
    }).catch(() => null);
    if (!res?.ok) return null;
    const out = { docId: staged.docId, b64: toB64(await res.arrayBuffer()), filename: staged.filename || "resume.pdf", mime: "application/pdf" };
    await chrome.storage.local.set({ [STAGED]: out });
    return out;
  }

  /**
   * A chosen résumé's file and details (cached by résumé and account for a
   * few minutes). Null when either can't be loaded — the caller says so.
   */
  async function chosenResume(t, resumeId, email) {
    const gen = generation;
    const { [CHOSEN]: cached } = await chrome.storage.local.get(CHOSEN);
    if (cached?.id === resumeId && cached.email === email && Date.now() - (cached.at || 0) < CHOSEN_MS) return cached;
    const headers = { Authorization: `Bearer ${t}` };
    const id = encodeURIComponent(resumeId);
    const [fileRes, detailsRes] = await Promise.all([
      wakeFetch(`${api}/v1/autofill/resumes/${id}/file`, { headers }).catch(() => null),
      wakeFetch(`${api}/v1/autofill/resumes/${id}/details`, { headers }).catch(() => null),
    ]);
    if (!fileRes?.ok || !detailsRes?.ok) return null;
    let details = await detailsRes.json().catch(() => null);
    if (!details) return null;
    // Never read yet: read it now, so its sections come from IT (spec 020).
    if (!details.read) {
      const readRes = await wakeFetch(`${api}/v1/autofill/resumes/${id}/read`, { method: "POST", headers }).catch(() => null);
      if (readRes?.ok) details = (await readRes.json().catch(() => null)) || details;
    }
    const out = {
      id: resumeId,
      email,
      at: Date.now(),
      b64: toB64(await fileRes.arrayBuffer()),
      filename: fileNameOf(fileRes),
      mime: fileRes.headers.get("Content-Type") || "application/pdf",
      text: typeof details?.text === "string" ? details.text : "",
      history: details?.read
        ? { work: details.work || [], education: details.education || [], skills: details.skills || [], certifications: details.certifications || [], websites: details.websites || [] }
        : null,
    };
    // Signed out (or another account) meanwhile: never cache the old one's.
    if (gen !== generation) return null;
    await chrome.storage.local.set({ [CHOSEN]: out });
    return out;
  }

  /**
   * A cover letter's text and PDF, fetched fresh for every fill: Claude may
   * save it again under the same id, or the user may edit it in the app, so a
   * kept copy could be the old text. Frames asking at the same moment share
   * one fetch. Null when it can't be loaded.
   */
  function coverLetter(t, letterId) {
    const k = `${generation}|${letterId}`;
    if (!lettersInFlight.has(k)) {
      lettersInFlight.set(
        k,
        fetchLetter(t, letterId).finally(() => lettersInFlight.delete(k)),
      );
    }
    return lettersInFlight.get(k);
  }

  async function fetchLetter(t, letterId) {
    const gen = generation;
    const res = await wakeFetch(`${api}/v1/autofill/cover-letters/${encodeURIComponent(letterId)}`, {
      headers: { Authorization: `Bearer ${t}` },
    }).catch(() => null);
    if (!res?.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body || typeof body.text !== "string") return null;
    if (gen !== generation) return null; // signed out meanwhile
    return {
      id: letterId,
      b64: typeof body.pdf_base64 === "string" ? body.pdf_base64 : "",
      filename: body.filename || "Cover letter.pdf",
      mime: "application/pdf",
      text: body.text,
    };
  }

  /** Can the chosen résumé be loaded? (The panel checks before using it.) */
  async function canLoad(resumeId) {
    const t = await token();
    if (!t) return false;
    const { [COPY]: held } = await chrome.storage.local.get(COPY);
    return !!(await chosenResume(t, resumeId, held?.email || "").catch(() => null));
  }

  /**
   * What autofill fills from, right now. Never waits on the server when a copy
   * is held (it refreshes in the background); the very first time it must.
   * @returns {Promise<{signedIn: boolean, copy?: object, resume?: object|null, coverLetter?: object|null, waited?: boolean}>}
   */
  async function get({ resumeId = null, coverLetterId = null } = {}) {
    const t = await token();
    if (!t) return { signedIn: false };
    let { [COPY]: held } = await chrome.storage.local.get(COPY);
    let waited = false;
    if (!held) {
      waited = true;
      await refresh();
      ({ [COPY]: held } = await chrome.storage.local.get(COPY));
      if (!held) return { signedIn: true, copy: null, resume: null, waited, error: "unreachable" };
    } else if (Date.now() - (held.fetched_at || 0) > REFRESH_MS) {
      refresh(); // in the background: this press uses what's held
    }
    // The résumé picked for this application (spec 020) wins — for the file
    // AND the jobs, schools and skills filled — then a staged tailored one,
    // then the usual one. Sections only ever come from the résumé uploaded:
    // a chosen one with no details leaves them for the user.
    const chosen = resumeId ? await chosenResume(t, resumeId, held.email || "").catch(() => null) : null;
    const staged = chosen ? null : await stagedResume(t).catch(() => null);
    const { [RESUME]: usual } = await chrome.storage.local.get(RESUME);
    const r = chosen || staged || usual || null;
    const history = chosen ? chosen.history : held.history;
    const letter = coverLetterId ? await coverLetter(t, coverLetterId).catch(() => null) : null;
    return {
      signedIn: true,
      waited,
      resumeId: chosen ? resumeId : null,
      copy: { profile: held.profile, email: held.email, answers: held.answers, taught: held.taught || [], history },
      // A staged tailored résumé has no text here: its box is left.
      resume: r ? { b64: r.b64, filename: r.filename, mime: r.mime, text: r.text || "" } : null,
      // The job's cover letter (spec 031), or none: its box is left.
      coverLetter: letter ? { b64: letter.b64, filename: letter.filename, mime: letter.mime, text: letter.text } : null,
      // The chosen résumé couldn't be loaded: this fill used the usual one.
      ...(resumeId && !chosen ? { chosenFailed: true } : {}),
    };
  }

  /** Signed out (or another account signed in): forget everything. */
  async function wipe() {
    generation++;
    inFlight = null; // the next refresh starts fresh, with the new account
    // The saved-jobs list the background matches pages against belonged to
    // that account too (spec 020 review).
    await chrome.storage.local.remove([COPY, RESUME, STAGED, CHOSEN, "je_saved_cache"]);
    // Every tab's résumé choice belonged to the account that signed out.
    const all = await chrome.storage.session.get(null).catch(() => ({}));
    const choices = Object.keys(all).filter((k) => k.startsWith("je_resume_choice:"));
    if (choices.length) await chrome.storage.session.remove(choices);
  }

  return { get, refresh, wipe, canLoad };
}
