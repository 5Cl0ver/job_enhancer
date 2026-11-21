/**
 * Claude Scout → Results: every job Scout found, in one place. Grouped Best /
 * Possible / Long shots against each run's own bar (the app works the groups
 * out, so phone and computer match), filtered by run, resume type and what
 * the user did with it. Each job opens, saves to My Jobs, or is passed on.
 */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { errorText } from "@/components/scout/errorText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useFindings,
  usePassFinding,
  useSaveFinding,
  useTracks,
} from "@/hooks/useScout";
import {
  BAND_HINT,
  BAND_LABEL,
  BANDS,
  type Band,
  type FindingFilters,
  type FindingItem,
  type FindingStatus,
  findingFacts,
  STATUS_LABEL,
  STATUSES,
} from "@/lib/scout";

const ALL = "all";
const PAGE = 100;
/** The most the app sends at once; past it, a filter narrows the list. */
const MAX_SHOWN = 500;

const BAND_STYLE: Record<Band, string> = {
  best: "bg-emerald-600 text-white hover:bg-emerald-600",
  possible: "bg-amber-500 text-white hover:bg-amber-500",
  long_shot: "",
};

/** Filters live in the address, so "See results" and the back button work. */
function useFilters(): [FindingFilters, (f: Partial<FindingFilters>) => void] {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") as FindingStatus | null;
  const filters: FindingFilters = {
    run: params.get("run") ?? "last",
    track: params.get("type"),
    status: status && STATUSES.includes(status) ? status : "new",
    sort: params.get("sort") === "newest" ? "newest" : "fit",
  };
  const set = (change: Partial<FindingFilters>) =>
    setParams(
      (p) => {
        const next = { ...filters, ...change };
        p.set("run", next.run ?? ALL);
        if (next.track) p.set("type", next.track);
        else p.delete("type");
        p.set("status", next.status);
        p.set("sort", next.sort);
        return p;
      },
      { replace: true },
    );
  return [{ ...filters, run: filters.run === ALL ? null : filters.run }, set];
}

export function ScoutResults() {
  const [filters, setFilters] = useFilters();
  const [limit, setLimit] = useState(PAGE);
  const { data: tracks } = useTracks();
  const { data, isLoading, isError } = useFindings(filters, limit);
  const [showLong, setShowLong] = useState(false);
  const counts = data?.counts;
  const oneRun = filters.run && filters.run !== "last";
  const runName = oneRun ? data?.items[0]?.run_name : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select
          value={filters.run ?? ALL}
          onValueChange={(v) => setFilters({ run: v === ALL ? null : v })}
        >
          <SelectTrigger aria-label="Which runs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last">Last run</SelectItem>
            <SelectItem value={ALL}>All runs</SelectItem>
            {oneRun && (
              <SelectItem value={filters.run!}>
                {runName ?? "That run"}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <Select
          value={filters.track ?? ALL}
          onValueChange={(v) => setFilters({ track: v === ALL ? null : v })}
        >
          <SelectTrigger aria-label="Resume type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All resume types</SelectItem>
            {tracks?.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.sort}
          onValueChange={(v) =>
            setFilters({ sort: v as FindingFilters["sort"] })
          }
        >
          <SelectTrigger aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fit">Best fit first</SelectItem>
            <SelectItem value="newest">Newest first</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={filters.status === s ? "default" : "outline"}
            aria-pressed={filters.status === s}
            aria-label={counts ? `${STATUS_LABEL[s]} ${counts[s]}` : undefined}
            className="pointer-coarse:min-h-11"
            onClick={() => setFilters({ status: s })}
          >
            {STATUS_LABEL[s]}
            {counts && <span className="tabular-nums"> {counts[s]}</span>}
          </Button>
        ))}
      </div>

      {isLoading && <Skeleton className="h-40" />}
      {isError && (
        <p className="text-sm text-destructive">
          Couldn't load the jobs. Try again.
        </p>
      )}
      {data && data.items.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {empty(filters)}
        </p>
      )}

      {data &&
        data.items.length > 0 &&
        (filters.sort === "newest" ? (
          <FindingList items={data.items} showRun={!filters.run} />
        ) : (
          BANDS.map((band) => {
            const items = data.items.filter((i) => i.band === band);
            if (!items.length) return null;
            const folded = band === "long_shot" && !showLong;
            return (
              <section key={band} className="space-y-2">
                <button
                  type="button"
                  className="flex w-full items-baseline gap-2 text-left pointer-coarse:min-h-11"
                  aria-expanded={!folded}
                  onClick={
                    band === "long_shot"
                      ? () => setShowLong(!showLong)
                      : undefined
                  }
                  disabled={band !== "long_shot"}
                >
                  {band === "long_shot" &&
                    (folded ? (
                      <ChevronRight
                        className="h-4 w-4 self-center"
                        aria-hidden
                      />
                    ) : (
                      <ChevronDown
                        className="h-4 w-4 self-center"
                        aria-hidden
                      />
                    ))}
                  <h3 className="font-semibold">
                    {BAND_LABEL[band]}{" "}
                    <span className="tabular-nums text-muted-foreground">
                      {counts?.[band] ?? items.length}
                    </span>
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {BAND_HINT[band]}
                  </span>
                </button>
                {!folded && (
                  <FindingList items={items} showRun={!filters.run} />
                )}
              </section>
            );
          })
        ))}

      {data?.next != null &&
        (limit < MAX_SHOWN ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setLimit(Math.min(limit + PAGE, MAX_SHOWN))}
          >
            Show more
          </Button>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            Showing the first {MAX_SHOWN}. Pick a run or a resume type to see
            the rest.
          </p>
        ))}
    </div>
  );
}

function empty(f: FindingFilters): string {
  const where = f.run === "last" ? " from the last run" : "";
  if (f.status === "new")
    return `No new jobs${where}. Start a search on the Start tab, or look at All runs.`;
  return `No ${STATUS_LABEL[f.status].toLowerCase()} jobs${where}.`;
}

function FindingList({
  items,
  showRun,
}: {
  items: FindingItem[];
  showRun: boolean;
}) {
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {items.map((f) => (
        <FindingCard key={f.id} finding={f} showRun={showRun} />
      ))}
    </ul>
  );
}

const linkClass =
  "inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline pointer-coarse:min-h-11";

export function FindingCard({
  finding: f,
  showRun,
}: {
  finding: FindingItem;
  showRun: boolean;
}) {
  const save = useSaveFinding();
  const pass = usePassFinding();
  const facts = findingFacts(f);
  const title = f.title || "Untitled job (open it to see)";
  const passOrUndo = (undo: boolean) =>
    pass.mutate(
      { id: f.id, undo },
      {
        onError: (e) => toast.error(errorText(e, "Couldn't change that job.")),
      },
    );

  return (
    <li className="space-y-1.5 p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <Badge
          variant={f.band === "long_shot" ? "secondary" : "default"}
          className={`shrink-0 tabular-nums ${BAND_STYLE[f.band]}`}
          title={`Claude's fit score, against your bar of ${f.min_fit}`}
        >
          {f.fit}/10
        </Badge>
        <div className="min-w-0 flex-1">
          {f.status === "saved" && f.job_listing_id ? (
            <Link
              to={`/jobs/${f.job_listing_id}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {title}
            </Link>
          ) : (
            <p className="font-medium break-words">{title}</p>
          )}
          <p className="text-sm text-muted-foreground break-words">
            {[f.company, facts].filter(Boolean).join(" · ")}
          </p>
          {f.facts_from === "claude" && f.title && (
            <p className="text-xs text-muted-foreground">As Claude read it</p>
          )}
        </div>
      </div>
      {f.app_note && (
        <p className="text-xs text-muted-foreground">{f.app_note}</p>
      )}
      {(f.why_fit || f.gaps) && (
        <div className="space-y-0.5 text-xs">
          {f.why_fit && (
            <p>
              <span className="font-medium">Why it fits · </span>
              {f.why_fit}
            </p>
          )}
          {f.gaps && (
            <p>
              <span className="font-medium">Gaps · </span>
              {f.gaps}
            </p>
          )}
        </div>
      )}
      {showRun && f.run_name && (
        <p className="text-xs text-muted-foreground">Found by {f.run_name}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1">
        {f.status === "new" && f.can_save && (
          <Button
            size="sm"
            className="gap-1.5 pointer-coarse:min-h-11"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                { findingId: f.id },
                {
                  onSuccess: (r) =>
                    toast.success(
                      r.already
                        ? "That job was already in My Jobs."
                        : `Saved to My Jobs › ${r.folder.name}`,
                    ),
                  onError: (e) =>
                    toast.error(errorText(e, "Couldn't save that job.")),
                },
              )
            }
          >
            {save.isPending && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            Save to My Jobs
          </Button>
        )}
        {f.status !== "saved" && (
          <a
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            {f.status === "new" && !f.can_save ? "Open and press Save" : "Open"}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
        {f.status === "new" && (
          <Button
            size="sm"
            variant="ghost"
            className="pointer-coarse:min-h-11"
            disabled={pass.isPending}
            onClick={() => passOrUndo(false)}
          >
            Pass
          </Button>
        )}
        {f.status === "passed" && (
          <Button
            size="sm"
            variant="outline"
            className="pointer-coarse:min-h-11"
            disabled={pass.isPending}
            onClick={() => passOrUndo(true)}
          >
            Undo pass
          </Button>
        )}
      </div>
    </li>
  );
}
