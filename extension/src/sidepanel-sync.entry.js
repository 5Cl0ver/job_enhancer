// Bundled for the side panel (a plain script): exposes the saved-jobs change
// check as a global so sidepanel.js can use the same tested module.
import { createSavedSync, MIN_INTERVAL_MS } from "./savedSync.js";

self.JobEnhancerSavedSync = { createSavedSync, MIN_INTERVAL_MS };
