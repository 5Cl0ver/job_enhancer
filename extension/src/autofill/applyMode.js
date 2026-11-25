// Apply with Claude (spec 022), the page side. Runs in every frame the
// autofill reader runs in, and does nothing until the background says an
// application is open on this site:
//
// - asks the background every few seconds (only while the page is showing)
//   whether Submit buttons are blocked here;
// - while they are, a final Submit press does nothing and the run log says so
//   (Claude in Chrome's clicks are real clicks, so this can't tell Claude from
//   the user: the user's own "I'll submit it myself" lifts the block first);
// - once they aren't, a final Submit press is reported, so a "submit it
//   myself" run ends as sent;
// - in the top frame, scrolls on request so the background can photograph a
//   long page screen by screen, then puts the scroll back.
import { finalSubmitButton, finalSubmitOfForm, pageAnswers } from "./applyPage.js";

const TICK_MS = 3000;

export function startApplyMode({ send, isCurrent, scan, readField, doc = document, win = window }) {
  let guard = false; // block final Submit presses on this page
  let active = false; // an application is open on this site
  let timer = null;

  const tick = async () => {
    if (!isCurrent()) return stop();
    if (doc.visibilityState !== "visible") return;
    const r = await send({ type: "applyTick", url: win.location.href });
    guard = !!r?.guard;
    active = !!r?.active;
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  // One press is a click and then the form's submit: report it once.
  let lastReport = 0;
  const report = (type) => {
    const now = Date.now();
    if (now - lastReport < 1500) return;
    lastReport = now;
    send({ type, url: win.location.href });
  };
  const onPress = (event, button) => {
    if (!active || !button) return;
    if (guard) {
      event.preventDefault();
      event.stopImmediatePropagation();
      report("applyBlocked");
    } else {
      report("applySubmitPressed");
    }
  };
  // Capture phase on the window: before the page's own handlers.
  win.addEventListener("click", (e) => onPress(e, finalSubmitButton(e.target)), true);
  win.addEventListener("submit", (e) => onPress(e, finalSubmitOfForm(e)), true);

  tick();
  timer = setInterval(tick, TICK_MS);

  /** Background requests: "measure", "scroll" to y, "answers". */
  const answer = (msg) => {
    const el = doc.scrollingElement || doc.documentElement;
    if (msg.op === "measure") {
      return { y: win.scrollY, height: el.scrollHeight, view: win.innerHeight };
    }
    if (msg.op === "scroll") {
      win.scrollTo({ top: msg.y, left: 0, behavior: "instant" });
      return new Promise((r) => setTimeout(() => r({ y: win.scrollY }), msg.settle ?? 350));
    }
    if (msg.op === "answers") return { answers: pageAnswers(scan(), readField) };
    return null;
  };

  return {
    answer,
    /** For tests: the current state. */
    get state() {
      return { guard, active };
    },
    stop,
  };
}
