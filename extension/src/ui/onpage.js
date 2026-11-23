// Everything Job Catcher draws on a job site lives in one shadow root, so the
// site's CSS can't restyle it (and ours can't leak into the site), in the web
// app's colors (panel/src/theme.css — the same indigo, radius and type), light
// or dark with the user's system. Spec 015, FR-028.
//
//   const root = uiRoot("content");   // one host per content script
//   root.appendChild(button);
//   root.getElementById("jec-save");

const HOST_PREFIX = "jec-ui-";

/** The values of the app's tokens this UI uses (light, then dark). */
const CSS = `
:host {
  all: initial;
  --primary: oklch(0.51 0.23 277);
  --primary-foreground: oklch(0.985 0 0);
  --card: oklch(1 0 0);
  --foreground: oklch(0.17 0.01 277);
  --muted: oklch(0.955 0.006 277);
  --muted-foreground: oklch(0.5 0.015 277);
  --border: oklch(0.915 0.006 277);
  --success: oklch(0.52 0.13 155);
  --warning: oklch(0.58 0.15 65);
  --destructive: oklch(0.577 0.245 27.325);
  --ring: oklch(0.6 0.19 277);
  --radius: 0.625rem;
  font: 500 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--foreground);
}
@media (prefers-color-scheme: dark) {
  :host {
    --primary: oklch(0.71 0.15 277);
    --primary-foreground: oklch(0.17 0.03 277);
    --card: oklch(0.2 0.015 277);
    --foreground: oklch(0.975 0.003 277);
    --muted: oklch(0.265 0.018 277);
    --muted-foreground: oklch(0.72 0.02 277);
    --border: oklch(1 0 0 / 12%);
    --success: oklch(0.72 0.15 155);
    --warning: oklch(0.78 0.14 75);
    --destructive: oklch(0.704 0.191 22.216);
  }
}
* { box-sizing: border-box; }
/* Set on the elements themselves: the host is reset (and a site may force fonts
   on it), so nothing is inherited from the page. */
.je-btn, .je-panel {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: 1.4; -webkit-font-smoothing: antialiased;
}
.je-panel { font-size: 13px; font-weight: 400; color: var(--foreground); }
button, select, input { font: inherit; color: inherit; }
button:focus-visible, select:focus-visible, input:focus-visible {
  outline: 2px solid var(--ring); outline-offset: 2px;
}

/* The floating action button: Save, Sync, the apply-flow badge. */
.je-btn {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
  display: inline-flex; align-items: center; gap: 6px;
  height: 38px; padding: 0 16px; border: 0; border-radius: 999px;
  font-weight: 600; font-size: 13.5px; letter-spacing: -0.005em;
  background: var(--primary); color: var(--primary-foreground);
  box-shadow: 0 1px 2px rgb(0 0 0 / 12%), 0 8px 24px rgb(0 0 0 / 18%);
  cursor: pointer; transition: transform .12s, background .15s, opacity .15s;
}
.je-btn:hover { transform: translateY(-1px); }
.je-btn[data-state="checking"], .je-btn[data-state="busy"] {
  background: var(--muted); color: var(--muted-foreground); cursor: default; transform: none;
}
.je-btn[data-state="saved"] {
  background: var(--card); color: var(--success); cursor: default;
  box-shadow: inset 0 0 0 1px var(--border), 0 8px 24px rgb(0 0 0 / 14%);
}
.je-btn[data-state="error"] { background: var(--destructive); color: #fff; }
.je-btn[data-state="stale"] { background: var(--warning); color: #111; }
.je-fab-left { left: 20px; right: auto; }
.je-fab-stack { bottom: 66px; }

/* Autofill pill: the main button plus Review / Undo once it has filled. */
.jec-pill {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
  display: flex; align-items: center; gap: 2px; padding: 3px;
  border-radius: 999px; background: var(--card);
  box-shadow: 0 0 0 1px var(--border), 0 8px 24px rgb(0 0 0 / 18%);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.jec-pill .je-btn { position: static; box-shadow: none; height: 34px; }
.jec-pill .je-btn[data-state="saved"] { box-shadow: none; background: transparent; }
.jec-pill-link {
  height: 30px; padding: 0 11px; border: 0; border-radius: 999px; cursor: pointer;
  background: transparent; color: var(--primary); font: 600 12.5px/1 ui-sans-serif, system-ui, sans-serif;
}
.jec-pill-link:hover { background: var(--muted); }
.jec-pill-link[hidden] { display: none; }

/* Indeed "My jobs" sync review: a card in the app's style. */
.je-panel {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
  width: 380px; max-width: calc(100vw - 40px); max-height: 78vh; overflow: auto;
  background: var(--card); color: var(--foreground);
  border-radius: calc(var(--radius) * 1.4);
  box-shadow: 0 0 0 1px var(--border), 0 16px 40px rgb(0 0 0 / 28%);
}
.je-sp-head {
  position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; background: var(--card); border-bottom: 1px solid var(--border);
  font-size: 14px; font-weight: 600;
}
.je-sp-close {
  border: 0; background: transparent; cursor: pointer; width: 28px; height: 28px;
  border-radius: 8px; color: var(--muted-foreground);
}
.je-sp-close:hover { background: var(--muted); color: var(--foreground); }
.je-sp-sub { padding: 8px 14px; font-size: 12px; color: var(--muted-foreground); }
.je-sp-body { padding: 0 14px; }
.je-sp-row { padding: 10px 0; border-bottom: 1px solid var(--border); }
.je-sp-top { display: flex; gap: 9px; align-items: flex-start; cursor: pointer; }
.je-sp-top input { margin-top: 3px; accent-color: var(--primary); }
.je-sp-title { font-weight: 600; font-size: 12.5px; }
.je-sp-co { font-size: 11.5px; color: var(--muted-foreground); margin-top: 1px; }
.je-sp-stage { display: flex; align-items: center; gap: 6px; margin: 7px 0 0 26px; }
.je-sp-badge {
  font-size: 11px; padding: 2px 8px; border-radius: 999px; white-space: nowrap;
  background: var(--muted); color: var(--foreground);
}
.je-sp-arrow { color: var(--muted-foreground); }
.je-sp-sel {
  flex: 1 1 auto; height: 30px; padding: 0 8px; border: 1px solid var(--border);
  border-radius: 8px; background: transparent;
}
.je-sp-sel option { background: var(--card); color: var(--foreground); }
.je-sp-foot {
  position: sticky; bottom: 0; display: flex; flex-direction: column; gap: 8px;
  padding: 12px 14px; background: var(--card); border-top: 1px solid var(--border);
}
.je-sp-btnrow { display: flex; justify-content: flex-end; gap: 8px; }
.je-sp-status { padding: 8px 10px; border-radius: 8px; font-size: 12px; background: var(--muted); }
.je-sp-status[data-kind="error"] { color: var(--destructive); }
.je-sp-sync {
  height: 34px; padding: 0 16px; border: 0; border-radius: 8px; cursor: pointer;
  background: var(--primary); color: var(--primary-foreground); font-weight: 600;
}
.je-sp-sync:disabled { opacity: .6; cursor: default; }
.je-sp-cancel {
  height: 34px; padding: 0 14px; border: 1px solid var(--border); border-radius: 8px;
  background: transparent; cursor: pointer;
}
.je-sp-cancel:hover { background: var(--muted); }
.je-sp-done { padding: 16px 14px 8px; text-align: center; }
.je-sp-done-big { font-size: 18px; font-weight: 700; color: var(--success); margin-bottom: 4px; }
.je-sp-done-note { padding: 8px 14px 12px; text-align: center; font-size: 12px; color: var(--muted-foreground); }
.je-sp-results { padding: 0 14px; }
.je-sp-rgroup { margin-bottom: 8px; }
.je-sp-rhead {
  font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
  margin: 8px 0 4px; color: var(--muted-foreground);
}
.je-sp-rrow {
  display: flex; justify-content: space-between; gap: 10px; padding: 4px 0;
  border-bottom: 1px solid var(--border); font-size: 12px;
}
.je-sp-rname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.je-sp-rstage { flex: 0 0 auto; color: var(--muted-foreground); }
`;

/**
 * The shadow root a content script draws in, made on first use. One per
 * script, so a newer copy (after an update) can remove an older one's whole UI.
 * @param {string} scope
 * @returns {ShadowRoot}
 */
export function uiRoot(scope) {
  const tag = HOST_PREFIX + scope;
  let host = document.querySelector(tag);
  if (!host || !host.shadowRoot) {
    host?.remove();
    host = document.createElement(tag);
    // The host takes no room and can't be restyled; its children are fixed.
    host.setAttribute("style", "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;");
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);
    document.documentElement.appendChild(host);
  }
  return host.shadowRoot;
}

/** Remove a script's whole on-page UI (a newer copy taking over). */
export function removeUi(scope) {
  for (const el of document.querySelectorAll(HOST_PREFIX + scope)) el.remove();
}

/** Did this event start on the element with this id inside a Job Catcher UI? */
export function eventOn(e, id) {
  return (e.composedPath?.() || []).some((n) => n && n.id === id);
}
