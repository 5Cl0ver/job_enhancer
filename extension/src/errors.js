// Turn API error responses into short, human-readable messages. FastAPI
// validation errors (422) arrive as {"detail":[{loc, msg, type}, …]} — raw JSON
// in a toast is useless to the user ("{"detail":[{"type":"int_from…"). Pure, so
// it's unit-tested.

/**
 * @param {number} status  HTTP status code
 * @param {string} text    raw response body (may be JSON or anything)
 * @returns {string} short human-readable error
 */
export function friendlyApiError(status, text) {
  try {
    const d = JSON.parse(text);
    if (typeof d.detail === "string") return d.detail;
    if (Array.isArray(d.detail)) {
      const parts = d.detail
        .map((e) => {
          const field = (e.loc || []).filter((p) => p !== "body").join(".");
          return field && e.msg ? `${field}: ${e.msg}` : e.msg || "";
        })
        .filter(Boolean);
      if (parts.length) return parts.join("; ").slice(0, 140);
    }
  } catch {
    /* not JSON — fall through */
  }
  return (text || "").slice(0, 140) || `Request failed (${status})`;
}
