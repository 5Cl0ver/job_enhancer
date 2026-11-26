/**
 * The app's version: the deployed commit's first 7 characters, or "dev"
 * (set at build time in vite.config.ts; spec 032, research R7). Bug reports
 * and caught errors carry it, so a report says which build it came from.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__
    ? __APP_VERSION__
    : "dev";
