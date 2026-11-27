// Apply with Claude (spec 022), the page side. Runs in every frame the
// autofill reader runs in, and does nothing until the background says this TAB
// is the open application's (frames inside it included):
//
// - asks the background every few seconds whether Submit is locked here (at
//   once on load, on showing again and on focus; slower while hidden);
// - while it is, a final Submit press does nothing and the run log says so
//   (Claude in Chrome's clicks are real clicks, so this can't tell Claude from
//   the user: the user's own "I'll submit it myself" lifts the lock first);
// - once it isn't, a Submit that really went (its form sent, the page moved
//   on, a confirmation, or the button gone a while with no error) is
//   reported, so a "submit it myself" run ends as sent; one the page turned
//   down (the button back, enabled, with a new error: Workday's way) is
//   reported as not gone through, with the page's error (spec 037). While a
//   press's outcome is pending, Job Catcher stops another Submit press itself;
//   a late success is still reported for ~2 minutes;
// - in the top frame, scrolls on request so the background can photograph a
//   long page screen by screen (the page, or its main scrolling box), then
//   puts the scroll back.
// A copy left behind by an extension update or reload lets go of everything.
import {
  confirmationIn,
  errorOnPage,
  finalSubmitButton,
  finalSubmitOfForm,
  pageAnswers,
  readableText,
  scrollerOf,
} from "./applyPage.js";

const TICK_MS = 3000;
const HIDDEN_TICK_MS = 10_000;
// A Submit with no form of its own (Workday): looked at this often after the
// press; gone this long with no error = sent; back and enabled with a new
// error after SUBMIT_FAILED_MS = it didn't go through (spec 037: Workday
// disables it while sending, then brings it back with an error). A late
// success (a confirmation, a new address) is watched for PRESS_WATCH_MS.
const SUBMIT_LOOK_MS = 500;
const SUBMIT_GONE_MS = 5000;
const SUBMIT_FAILED_MS = 20_000;
const PRESS_WATCH_MS = 120_000;
// After a press, another Submit press waits this long (or until the page says
// it didn't go through): the app's lock can take a few seconds to arrive.
const PENDING_MS = 25_000;
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
    // one): look for the confirmation. A page that was already showing when
    // the watch began counts only what appears after.
    if (r?.watch) {
      if (before === undefined) before = shownNow();
      lookForConfirmation();
    }
  };

  // "Thank you for applying": tell the background once, with its words. Words
  // already on the page before the Submit press never count.
  let confirmed = false;
  let watching = null;
  // What the page said before (undefined = a new page: nothing to compare).
  let before;
  const shownNow = () => confirmationIn(readableText(doc.body)) || null;
  const lookForConfirmation = async () => {
    if (confirmed) return;
    const words = shownNow();
    if (words && words !== before) {
      confirmed = true;
      const r = await send({ type: "applyConfirmed", url: win.location.href, words });
      if (!r?.ok) confirmed = false; // try again next time
    }
  };
  const watchAfterSubmit = () => {
    if (watching) return;
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
  const report = (type, more = {}) => {
    const now = Date.now();
    if (now - (lastSent[type] || 0) < 1500) return;
    lastSent[type] = now;
    send({ type, url: win.location.href, ...more });
    if (type === "applySubmitPressed") watchAfterSubmit();
  };

  /**
   * Sent, really (spec 037): the page moved on, a confirmation showed, or
   * every final Submit is gone for 5 s with no error showing. Disabled
   * doesn't count (Workday disables it while it sends). Turned down: 20 s on,
   * Submit is showing, enabled, with a new error on the page; anything else
   * (still sending, just gone, no error) says nothing and keeps watching. A
   * late success is reported for ~2 minutes, after a turn-down too.
   */
  let watchId = 0; // a new press starts a new watch
  let pendingUntil = 0; // another Submit press waits until then
  const reportWhenGone = (button) => {
    const id = ++watchId;
    const href = win.location.href;
    const errorBefore = errorOnPage(doc);
    const words = before;
    const t0 = Date.now();
    let goneSince = 0;
    let failedSent = false;
    const shownBox = (el) => el.isConnected && !el.hidden && (typeof el.checkVisibility !== "function" || el.checkVisibility());
    // The button, or the same button drawn again (Workday re-draws it): the
    // same words, in the same form (or none).
    const label = (el) => (el.value || el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    const formOf = (el) => el.form || el.closest?.("form") || null;
    const again = (b) => label(b) === label(button) && formOf(b) === formOf(button) && !!finalSubmitButton(b);
    const shownSubmits = () => [button, ...doc.querySelectorAll("button, [role='button'], input[type='submit']")].filter((b) => shownBox(b) && (b === button || again(b)));
    const enabled = (b) => !b.disabled && b.getAttribute("aria-disabled") !== "true";
    const look = () => {
      if (id !== watchId || !live() || !active) return;
      const now = Date.now();
      const said = shownNow();
      if (win.location.href !== href || (said && said !== words)) {
        pendingUntil = 0;
        report("applySubmitPressed");
        if (said && said !== words) lookForConfirmation();
        return;
      }
      // Sent, and the app has locked Submit again: its watch takes it from here.
      if (guard) return;
      const error = errorOnPage(doc);
      const newError = !!error && error !== errorBefore;
      const submits = shownSubmits();
      if (!submits.length && !failedSent) {
        goneSince ||= now;
        if (now - goneSince >= SUBMIT_GONE_MS && !newError) {
          pendingUntil = 0;
          return report("applySubmitPressed");
        }
      } else goneSince = 0;
      if (!failedSent && now - t0 >= SUBMIT_FAILED_MS && newError && submits.some(enabled)) {
        failedSent = true;
        pendingUntil = 0; // known now: one more press may go
        send({ type: "applySubmitFailed", url: win.location.href, error });
      }
      if (now - t0 < PRESS_WATCH_MS) setTimeout(look, SUBMIT_LOOK_MS);
    };
    setTimeout(look, SUBMIT_LOOK_MS);
  };

  /** A Submit press while the last one's outcome is pending: stopped here. */
  const stopIfPending = (event) => {
    if (Date.now() >= pendingUntil) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    report("applyBlocked", { reason: "pending" });
    return true;
  };

  const onClick = (event) => {
    if (!live() || !active) return;
    const button = finalSubmitButton(event.composedPath?.()[0] || event.target);
    if (!button) return;
    if (!guard && before === undefined) before = shownNow();
    if (guard) {
      event.preventDefault();
      event.stopImmediatePropagation();
      report("applyBlocked");
    } else if (stopIfPending(event)) {
      return;
    } else if (!(button.form && (button.type || "").toLowerCase() === "submit")) {
      pendingUntil = Date.now() + PENDING_MS;
      reportWhenGone(button); // a real submit button's form reports via its submit event
    }
  };
  const onSubmit = (event) => {
    if (!live() || !active) return;
    const button = finalSubmitOfForm(event);
    if (!button) return;
    if (!guard && before === undefined) before = shownNow();
    if (guard) {
      event.preventDefault();
      event.stopImmediatePropagation();
      report("applyBlocked");
    } else if (stopIfPending(event)) {
      return;
    } else if (event.target?.checkValidity?.() !== false) {
      // A form with a required box left empty isn't sent: no report.
      pendingUntil = Date.now() + PENDING_MS;
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
