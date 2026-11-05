import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { __test__ } from "@/hooks/useRealtimeSync";

const { alreadyInCache } = __test__;

function clientWith(jobs: { id: string; updated_at: string }[]) {
  const qc = new QueryClient();
  qc.setQueryData(["saved-jobs", undefined], jobs);
  return qc;
}

// Minimal Realtime payloads (only the fields the hook reads).
const change = (eventType: "INSERT" | "UPDATE" | "DELETE", row: object) =>
  ({
    eventType,
    new: eventType === "DELETE" ? {} : row,
    old: eventType === "DELETE" ? row : {},
  }) as never;

describe("realtime sync echo check", () => {
  const ts = "2026-11-03T15:00:00.123456+00:00";

  it("skips an update the cache already has (our own edit's echo)", () => {
    const qc = clientWith([{ id: "a", updated_at: "2026-11-03T15:00:00.123Z" }]);
    expect(alreadyInCache(qc, change("UPDATE", { id: "a", updated_at: ts }))).toBe(true);
  });

  it("refreshes for a newer remote update", () => {
    const qc = clientWith([{ id: "a", updated_at: "2026-11-03T14:00:00Z" }]);
    expect(alreadyInCache(qc, change("UPDATE", { id: "a", updated_at: ts }))).toBe(false);
  });

  it("refreshes for a job saved elsewhere, skips one already listed", () => {
    const qc = clientWith([{ id: "a", updated_at: ts }]);
    expect(alreadyInCache(qc, change("INSERT", { id: "b", updated_at: ts }))).toBe(false);
    expect(alreadyInCache(qc, change("INSERT", { id: "a", updated_at: ts }))).toBe(true);
  });

  it("refreshes for a delete of a listed job, skips one already gone", () => {
    const qc = clientWith([{ id: "a", updated_at: ts }]);
    expect(alreadyInCache(qc, change("DELETE", { id: "a" }))).toBe(false);
    expect(alreadyInCache(qc, change("DELETE", { id: "z" }))).toBe(true);
  });

  it("refreshes when nothing is cached yet", () => {
    expect(alreadyInCache(new QueryClient(), change("INSERT", { id: "a" }))).toBe(false);
  });
});
