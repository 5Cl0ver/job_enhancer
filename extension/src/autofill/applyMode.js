// Apply with Claude (spec 022), the page side. Runs in every frame the
// autofill reader runs in, and does nothing until the background says this TAB
// is the open application's (frames inside it included):
//
// - asks the background every few seconds whether Submit is locked here (at
//   once on load, on showing again and on focus; slower while hidden);
// - while it is, a final Submit press does nothing and the run log says so
//   (Claude in Chrome's clicks are real clicks, so this can't tell Claude from
//   the user: the user's own "I'll submit it myself" lifts the lock first);
// - once it isn't, a Submit that really went (its form sent, or the page moved
//   on) is reported, so a "submit it myself" run ends as sent;
// - in the top frame, scrolls on request so the background can photograph a
//   long page screen by screen (the page, or its main scrolling box), then
//   puts the scroll back.
// A copy left behind by an extension update or reload lets go of everything.
import {
  confirmationIn,
  finalSubmitButton,
  finalSubmitOfForm,
  pageAnswers,
  readableText,
  scrollerOf,
} from "./applyPage.js";

const TICK_MS = 3000;
const HIDDEN_TICK_MS = 10_000;
const SETTLE_REPORT_MS = 2000;
const WATCH_MS = 20_000; // after a Submit, how long to look for the confirmation
const WATCH_EVERY_MS = 2000;

export function startApplyMode({ send, isCurrent, scan, readField, doc = document, win = window }) {
  let guard = false; // lock final Submit presses on this page
  let active = false; // this tab is the open application's
  let timer = null;
  let lastTick = 0;
  const live = () => isCurrent();

  const tick = async () => {
    if (!live()) return stop();
    const now = Date.now();
    if (doc.visibilityState !== "visible" && now - lastTick < HIDDEN_TICK_MS) return;
    lastTick = now;
    const r = await send({ type: "applyTick", url: win.location.href });
    if (!live()) return stop();
    guard = !!r?.guard;
    active = !!r?.active;
    // A Submit was just pressed in this tab (maybe on the page before this
    // one), or Claude is pressing it: look for the confirmation.
    if (r?.watch) lookForConfirmation();
  };

  // "Thank you for applying": tell the background once, with its words. Words
  // already on the page before the Submit press never count.
  let confirmed = false;
  let watching = null;
  let before = null;
  const lookForConfirmation = () => {
    if (confirmed) return;
    const words = confirmationIn(readableText(doc.body));
    if (words && words !== before) {
      confirmed = true;
      send({ type: "applyConfirmed", url: win.location.href, words });
    }
  };
  const watchAfterSubmit = () => {
    if (watching) return;
    before = confirmationIn(readableText(doc.body)) || null;
    const until = Date.now() + WATCH_MS;
    watching = setInterval(() => {
      if (!live() || confirmed || Date.now() > until) {
        clearInterval(watching);
        watching = null;
        return;
      }
      lookForConfirmation();
    }, WATCH_EVERY_MS);
  };

  // One report per kind per press (a press is a click and maybe a submit).
  const lastSent = {};
  const report = (type) => {
    const now = Date.now();
    if (now - (lastSent[type] || 0) < 1500) return;
    lastSent[type] = now;
    send({ type, url: win.location.href });
    if (type === "applySubmitPressed") watchAfterSubmit();
  };

  /** Sent, really: its form was sent, or the page changed or the button went. */
  const reportWhenGone = (button) => {
    const href = win.location.href;
    setTimeout(() => {
      if (!live() || !active || guard) return;
      if (!button.isConnected || win.location.href !== href || button.disabled) report("applySubmitPressed");
    }, SETTLE_REPORT_MS);
  };

  const onClick = (event) => {
    if (!live() || !active) return;
    const button = finalSubmitButton(event.composedPath?.()[0] || event.target);
    if (!button) return;
    if (guard) {
      event.preventDefault();
      event.stopImmediatePropagation();
      report("applyBlocked");
    } else if (!(button.form && (button.type || "").toLowerCase() === "submit")) {
      reportWhenGone(button); // a real submit button's form reports via its submit event
    }
  };
  const onSubmit = (event) => {
    if (!live() || !active) return;
    const button = finalSubmitOfForm(event);
    if (!button) return;
    if (guard) {
      event.preventDefault();
      event.stopImmediatePropagation();
      report("applyBlocked");
    } else if (event.target?.checkValidity?.() !== false) {
      // A form with a required box left empty isn't sent: no report.
      report("applySubmitPressed");
    }
  };
  const onShow = () => {
    lastTick = 0;
    tick();
  };

  // Capture phase on the window: before the page's own handlers.
  win.addEventListener("click", onClick, true);
  win.addEventListener("submit", onSubmit, true);
  doc.addEventListener("visibilitychange", onShow);
  win.addEventListener("focus", onShow);

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (watching) clearInterval(watching);
    watching = null;
    guard = false;
    active = false;
    win.removeEventListener("click", onClick, true);
    win.removeEventListener("submit", onSubmit, true);
    doc.removeEventListener("visibilitychange", onShow);
    win.removeEventListener("focus", onShow);
  }

  tick();
  timer = setInterval(tick, TICK_MS);

  // The page, or its main scrolling box when the page itself doesn't scroll.
  let scroller = null;
  const box = () => {
    const page = doc.scrollingElement || doc.documentElement;
    if (page.scrollHeight > win.innerHeight + 4) return null;
    return scrollerOf(doc, win);
  };

  /** Background requests: "measure", "scroll" to y, "answers". */
  const answer = (msg) => {
    if (!live()) return null;
    if (msg.op === "measure") {
      scroller = box();
      if (scroller) return { y: scroller.scrollTop, height: scroller.scrollHeight, view: scroller.clientHeight };
      const el = doc.scrollingElement || doc.documentElement;
      return { y: win.scrollY, height: el.scrollHeight, view: win.innerHeight };
    }
    if (msg.op === "scroll") {
      if (scroller) scroller.scrollTo({ top: msg.y, left: 0, behavior: "instant" });
      else win.scrollTo({ top: msg.y, left: 0, behavior: "instant" });
      return new Promise((r) => setTimeout(() => r({ y: msg.y }), msg.settle ?? 350));
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
