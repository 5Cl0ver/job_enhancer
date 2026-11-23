import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { App } from "./App";
import { PanelProvider } from "./lib/store";

// Follow Chrome's light/dark setting, live — the app's `.dark` tokens.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PanelProvider>
      <App />
    </PanelProvider>
  </StrictMode>,
);
