/**
 * A tiny fake of the app's Apply with Claude routes (spec 033) for component
 * tests: the run lives "on the server", every call changes it the way the
 * real routes do, and the page re-reads it, so a waiting fix shows after a
 * tap just as it would for the owner.
 */
import type { ApplyRun, RunFix } from "@/lib/apply";

type Body = Record<string, unknown> | undefined;

const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function fakeRun(start: ApplyRun) {
  let run = copy(start);
  let n = 0;
  const calls: { method: string; path: string; body?: Body }[] = [];
  const base = `/v1/apply/runs/${start.id}`;

  const rowOf = (step: string, q: string, k: number) =>
    run.sheet?.steps.find((s) => s.key === step)?.rows.filter((r) => r.q === q)[k - 1];

  function handle(method: string, path: string, body?: Body): ApplyRun {
    calls.push({ method, path, body });
    const fixes: RunFix[] = run.fixes ?? [];
    if (method === "GET" && path === base) return copy(run);
    if (method === "POST" && path === `${base}/fixes`) {
      const { step, q, k = 1, to, ask } = body as { step: string; q: string; k?: number; to?: string; ask?: string };
      const same = fixes.find((f) => f.status === "waiting" && f.step === step && f.q === q && f.k === k);
      if (same) Object.assign(same, { to, ask });
      else
        fixes.push({ id: `f${++n}`, step, q, k, now: rowOf(step, q, k)?.a ?? "", to, ask, status: "waiting", at: "" });
      run.fixes = fixes;
    } else if (method === "PATCH" && path.startsWith(`${base}/fixes/`)) {
      Object.assign(fixes.find((f) => path.endsWith(f.id))!, body);
    } else if (method === "DELETE" && path.startsWith(`${base}/fixes/`)) {
      run.fixes = fixes.filter((f) => !path.endsWith(f.id));
    } else if (method === "POST" && path === `${base}/fixes/send`) {
      for (const f of fixes) if (f.status === "waiting") f.status = "sent";
      if (run.status === "review" && run.review) run.review = { ...run.review, decision: "fix" };
    } else if (method === "POST" && path === `${base}/continue`) {
      for (const f of fixes) if (f.status === "waiting" && f.step === run.paused_step) f.status = "sent";
      // Spec 038: the go-on waits for Claude to get it.
      const title = run.sheet?.steps.find((s) => s.key === run.paused_step)?.title ?? "";
      if (run.sheet) run.sheet.check = { step: run.paused_step!, title, at: new Date().toISOString(), read: false };
      run.paused_step = null;
      run.paused_title = null;
    } else if (method === "POST" && path.startsWith(`${base}/fixes/`) && path.endsWith("/did-it")) {
      Object.assign(fixes.find((f) => path.includes(`/${f.id}/`))!, { status: "done", by_you: true });
    } else if (method === "PATCH" && path === `${base}/mode`) {
      run.mode = (body as { mode: ApplyRun["mode"] }).mode;
    } else if (method === "POST" && path === `${base}/decision`) {
      run.review = { ...run.review!, decision: (body as { decision: "submit" | "fix" | "self" }).decision };
    }
    return copy(run);
  }

  return {
    get: (path: string) => Promise.resolve(path === base ? handle("GET", path) : []),
    post: (path: string, body?: Body) => Promise.resolve(handle("POST", path, body)),
    patch: (path: string, body?: Body) => Promise.resolve(handle("PATCH", path, body)),
    delete: (path: string) => Promise.resolve(handle("DELETE", path)),
    calls,
    now: () => run,
  };
}
