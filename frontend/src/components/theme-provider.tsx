/**
 * App theme (light / dark / system).
 *
 * The design tokens already have a `.dark` variant in `globals.css`; this
 * provider just decides whether to put the `dark` class on <html>. Three modes:
 *   - "light" / "dark": an explicit user choice, remembered in localStorage.
 *   - "system": follow the OS preference and keep following it live.
 *
 * FOUC note: the *initial* class is set by an inline script in index.html so the
 * first paint is already correct. This provider re-syncs on mount and on change.
 */
import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

type ThemeContextValue = {
  /** The user's choice, including "system". */
  theme: Theme;
  /** What's actually on screen right now ("system" resolved to light/dark). */
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Apply the resolved theme to <html> and return which one we applied. */
function applyTheme(theme: Theme): "light" | "dark" {
  const resolved = theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  return resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme,
  );

  // Re-apply whenever the choice changes.
  useEffect(() => {
    setResolvedTheme(applyTheme(theme));
  }, [theme]);

  // In "system" mode, follow OS changes live.
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolvedTheme(applyTheme("system"));
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = (next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
