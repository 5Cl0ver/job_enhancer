/**
 * Small layout choices remembered on this device (browser localStorage). One
 * place for the keys; a missing or unreadable value just means the default.
 */
const KEYS = {
  /** The stage chip last chosen on the phone's My Jobs list. */
  jobsStage: "ui.jobsStage",
} as const;

export type PrefKey = keyof typeof KEYS;

export function readPref(key: PrefKey): string | null {
  try {
    return window.localStorage.getItem(KEYS[key]);
  } catch {
    return null; // private mode, storage blocked
  }
}

export function writePref(key: PrefKey, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(KEYS[key]);
    else window.localStorage.setItem(KEYS[key], value);
  } catch {
    // Nothing to do: the choice just won't be remembered.
  }
}
