/**
 * The part of My Jobs' view that lives in the address bar, so other pages can
 * link straight to it: `?folder=<collection id>` and `?origin=<where from>`.
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { ORIGINS, type Origin } from "@/lib/origin";

export const ANY_ORIGIN = "all";

export function useJobsParams() {
  const [params, setParams] = useSearchParams();
  const folder = params.get("folder");
  // An origin the app doesn't know (a stale or mistyped link) filters nothing.
  const asked = params.get("origin");
  const origin = ORIGINS.includes(asked as Origin) ? (asked as Origin) : ANY_ORIGIN;

  const put = useCallback(
    (key: "folder" | "origin", value: string | null) =>
      setParams(
        (p) => {
          if (value === null) p.delete(key);
          else p.set(key, value);
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );
  const setFolder = useCallback((id: string | null) => put("folder", id), [put]);
  const setOrigin = useCallback(
    (o: string) => put("origin", o === ANY_ORIGIN ? null : o),
    [put],
  );

  // Both at once. Two separate changes in one tick would each start from the
  // same old address, and the second would put back what the first removed.
  const clear = useCallback(
    () =>
      setParams(
        (p) => {
          p.delete("folder");
          p.delete("origin");
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );

  return { folder, origin, setFolder, setOrigin, clear };
}
