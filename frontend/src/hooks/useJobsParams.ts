/**
 * The part of My Jobs' view that lives in the address bar, so other pages can
 * link straight to it: `?folder=<collection id>` and `?origin=<where from>`.
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export const ANY_ORIGIN = "all";

export function useJobsParams() {
  const [params, setParams] = useSearchParams();
  const folder = params.get("folder");
  const origin = params.get("origin") ?? ANY_ORIGIN;

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

  return { folder, origin, setFolder, setOrigin };
}
