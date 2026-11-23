// The copy of the user's details autofill fills from (spec 015, R1). Kept in
// chrome.storage.local so a press NEVER waits on the server (a free server
// sleeps): it's refreshed with a cheap version check at most once a minute, on
// sign-in, and when the side panel opens. Wiped on sign-out.
//
// Holds: profile, email, remembered answers (GET /v1/autofill/bundle), and the
// résumé file (GET /v1/ai/resumes/active/file, fetched again only when the
// résumé changes). A tailored résumé staged in Write wins over the usual one.

const COPY = "je_autofill";
const RESUME = "je_resume_bytes";
const STAGED = "je_staged_bytes";
const REFRESH_MS = 60_000;

/**
 * @param {{api: string, token: () => Promise<string|null>, wakeFetch: Function, toB64: (buf: ArrayBuffer) => string}} deps
 */
export function createAutofillCopy({ api, token, wakeFetch, toB64 }) {
  let inFlight = null;
  // Bumped by wipe(): a refresh that started before a sign-out (or another
  // account's sign-in) must never write the old account's data back.
  let generation = 0;

  async function fetchResume(headers, meta, gen) {
    const { [RESUME]: cached } = await chrome.storage.local.get(RESUME);
    const stamp = `${meta.id}|${meta.updated_at}`;
    if (cached?.stamp === stamp) return;
    const res = await wakeFetch(`${api}/v1/ai/resumes/active/file`, { headers });
    if (!res.ok || gen !== generation) return;
    const b64 = toB64(await res.arrayBuffer());
    if (gen !== generation) return;
    await chrome.storage.local.set({
      [RESUME]: {
        stamp,
        b64,
        filename: res.headers.get("X-Resume-Filename") || meta.filename || "resume.pdf",
        mime: res.headers.get("Content-Type") || meta.mime || "application/pdf",
      },
    });
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
          history: b.history || null,
          resume: b.resume || null,
        },
      });
      if (b.resume) await fetchResume(headers, b.resume, gen).catch(() => {});
      else await chrome.storage.local.remove(RESUME);
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
   * What autofill fills from, right now. Never waits on the server when a copy
   * is held (it refreshes in the background); the very first time it must.
   * @returns {Promise<{signedIn: boolean, copy?: object, resume?: object|null, waited?: boolean}>}
   */
  async function get() {
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
    const staged = await stagedResume(t).catch(() => null);
    const { [RESUME]: usual } = await chrome.storage.local.get(RESUME);
    const r = staged || usual || null;
    return {
      signedIn: true,
      waited,
      copy: { profile: held.profile, email: held.email, answers: held.answers, history: held.history },
      resume: r ? { b64: r.b64, filename: r.filename, mime: r.mime } : null,
    };
  }

  /** Signed out (or another account signed in): forget everything. */
  async function wipe() {
    generation++;
    inFlight = null; // the next refresh starts fresh, with the new account
    await chrome.storage.local.remove([COPY, RESUME, STAGED]);
  }

  return { get, refresh, wipe };
}
