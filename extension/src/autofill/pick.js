// "Point at a box" (spec 017, research R6): started from the side panel, the
// page outlines whatever box the pointer is over; a click picks it — the page
// never receives that click — and Esc stops. Nothing is drawn on the page
// outside this mode (spec 016). Adapted from uBlock Origin's element picker:
// an outline that ignores the pointer, capture-phase listeners on the window
// (so a pop-up's own handlers never see the clicks), composedPath() to reach
// inside page components (open and closed shadow roots).
import { shadowOf } from "./scan.js";

/** What can be picked: a box to type in, a dropdown, a group of choices. */
const PICKABLE =
  'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]), select, textarea, [contenteditable=""], [contenteditable="true"], [role=combobox], [role=textbox], [role=radiogroup], [role=listbox], button[aria-haspopup=listbox]';

/** The box at the pointer: the control itself, or the one its label names. */
export function controlAt(path) {
  for (const n of path) {
    if (n?.nodeType !== 1) continue;
    if (n.matches?.(PICKABLE)) return n;
    if (n.tagName === "LABEL") {
      const c = n.control || n.querySelector?.(PICKABLE);
      if (c) return c;
    }
    if (n.tagName === "FORM" || n.tagName === "BODY") return null;
  }
  return null;
}

/**
 * The path from the deepest element under the pointer up to the page. A
 * CLOSED page component hides its insides from the page's listeners
 * (composedPath stops at its host), so look inside it at the same point.
 */
export function pathAt(e) {
  let el = (e.composedPath?.() || [e.target])[0];
  for (let hop = 0; el && hop < 10; hop++) {
    const sr = el.nodeType === 1 ? shadowOf(el) : null;
    const inner = sr?.elementFromPoint?.(e.clientX, e.clientY);
    if (!inner || inner === el) break;
    el = inner;
  }
  const path = [];
  for (let n = el; n; n = n.parentNode || n.host) path.push(n);
  return path;
}

const CSS = `
:host { all: initial; }
.box { position: fixed; z-index: 2147483647; pointer-events: none; display: none;
  border: 2px solid oklch(0.55 0.2 275); border-radius: 6px; background: oklch(0.55 0.2 275 / 0.12);
  box-shadow: 0 0 0 4px oklch(0.55 0.2 275 / 0.18); transition: all 60ms ease-out; }
.tag { position: absolute; left: -2px; top: -26px; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis;
  font: 600 12px/1 ui-sans-serif, system-ui, sans-serif; color: #fff; background: oklch(0.45 0.2 275);
  padding: 6px 8px; border-radius: 6px 6px 6px 0; }
`;

/**
 * @param {{labelFor: (el: Element) => string, onPick: (el: Element) => void, onCancel: () => void}} deps
 */
export function createPicker({ labelFor, onPick, onCancel, alive = () => true }) {
  let on = false;
  let host = null;
  let box = null;
  let tag = null;
  let cursor = null;
  let current = null;
  let frame = 0;

  function mount() {
    host = document.createElement("jec-ui-pick");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${CSS}</style><div class="box"><span class="tag"></span></div>`;
    box = root.querySelector(".box");
    tag = root.querySelector(".tag");
    // Above a native modal <dialog> (the top layer) means inside it.
    (document.querySelector("dialog:modal") || document.documentElement).appendChild(host);
    cursor = document.createElement("style");
    cursor.textContent = "*, *::before, *::after { cursor: crosshair !important; }";
    document.documentElement.appendChild(cursor);
  }

  function draw() {
    frame = 0;
    if (!box) return;
    if (!current?.isConnected) {
      box.style.display = "none";
      return;
    }
    const r = current.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 2}px`, height: `${r.height + 2}px` });
    tag.textContent = labelFor(current) || "This box";
    tag.style.top = r.top < 30 ? `${r.height + 6}px` : "-26px";
  }
  const schedule = () => (frame ||= requestAnimationFrame(draw));

  const swallow = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  function move(e) {
    if (!alive()) return stop(); // an update replaced this copy: let the page go
    current = controlAt(pathAt(e));
    schedule();
  }
  function press(e) {
    if (!alive()) return stop();
    swallow(e);
    if (e.type !== "click") return;
    const picked = controlAt(pathAt(e));
    if (!picked) return; // not a box: keep pointing
    stop();
    onPick(picked);
  }
  function key(e) {
    if (e.key !== "Escape") return;
    swallow(e);
    stop();
    onCancel();
  }

  const EVENTS = [
    ["pointermove", move],
    ["pointerover", move],
    ["pointerdown", press],
    ["mousedown", press],
    ["pointerup", press],
    ["mouseup", press],
    ["click", press],
    ["dblclick", press],
    ["auxclick", press],
    ["touchstart", press],
    ["touchend", press],
    ["contextmenu", press],
    ["keydown", key],
    ["scroll", schedule],
    ["resize", schedule],
  ];

  function start() {
    if (on) return;
    on = true;
    mount();
    for (const [type, fn] of EVENTS) window.addEventListener(type, fn, true);
  }

  function stop() {
    if (!on) return;
    on = false;
    for (const [type, fn] of EVENTS) window.removeEventListener(type, fn, true);
    cancelAnimationFrame(frame);
    frame = 0;
    host?.remove();
    cursor?.remove();
    host = box = tag = cursor = current = null;
  }

  return { start, stop, get on() {
    return on;
  } };
}
