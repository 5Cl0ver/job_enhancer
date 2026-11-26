import { useEffect, useState } from "react";
import {
  CheckSquare,
  Copy,
  Loader2,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Segmented } from "@/components/bugs/BugForm";
import { BugRow } from "@/components/bugs/BugRow";
import { BulkBar } from "@/components/bugs/BulkBar";
import { ManualCopy, useCopy } from "@/components/bugs/CopyForClaude";
import { useBugList } from "@/hooks/useBugReports";
import {
  type BugFilters,
  type BugSeverity,
  type BugSource,
  type BugStatus,
  SECTIONS,
  SECTION_LABEL,
  SEVERITIES,
  SEVERITY_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  statusesFor,
} from "@/lib/bugs";
import { bugReport, bugsReport } from "@/lib/bugReport";
import { cn } from "@/lib/utils";

export const START: BugFilters = { type: "bug", status: "open" };

/** The search, once typing pauses. */
function useSettled(value: string | undefined, ms = 250): string | undefined {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

const CHIP =
  "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-colors pointer-coarse:min-h-10";

function Chip({
  on,
  onClick,
  children,
  label,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        CHIP,
        on
          ? "border-primary bg-primary text-primary-foreground"
          : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** How many filters (beyond the tab, the section and the search) are on. */
function extraFilters(f: BugFilters): number {
  return [
    f.status !== "open",
    !!f.severity,
    !!f.source,
    !!f.came_back,
    !!f.needs_check,
  ].filter(Boolean).length;
}

function FilterSheet({
  open,
  onOpenChange,
  filters,
  onChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  filters: BugFilters;
  onChange: (f: BugFilters) => void;
}) {
  const set = (patch: Partial<BugFilters>) =>
    onChange({ ...filters, ...patch });
  const statuses: (BugStatus | "open" | "all")[] = [
    "open",
    ...statusesFor(filters.type),
    "all",
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Filter</DialogTitle>
          <DialogDescription className="sr-only">
            Narrow the list.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Status</legend>
            <div className="flex flex-wrap gap-1.5">
              {statuses.map((s) => (
                <Chip
                  key={s}
                  on={filters.status === s}
                  onClick={() => set({ status: s })}
                >
                  {s === "open"
                    ? "Open"
                    : s === "all"
                      ? "All"
                      : STATUS_LABEL[s]}
                </Chip>
              ))}
            </div>
          </fieldset>
          {filters.type === "bug" && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Severity</legend>
              <div className="flex flex-wrap gap-1.5">
                <Chip
                  on={!filters.severity}
                  onClick={() => set({ severity: undefined })}
                >
                  Any
                </Chip>
                {SEVERITIES.map((s) => (
                  <Chip
                    key={s}
                    on={filters.severity === s}
                    onClick={() => set({ severity: s as BugSeverity })}
                  >
                    {SEVERITY_LABEL[s]}
                  </Chip>
                ))}
              </div>
            </fieldset>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">From</legend>
            <div className="flex flex-wrap gap-1.5">
              <Chip
                on={!filters.source}
                onClick={() => set({ source: undefined })}
              >
                Anyone
              </Chip>
              {(Object.keys(SOURCE_LABEL) as BugSource[]).map((s) => (
                <Chip
                  key={s}
                  on={filters.source === s}
                  onClick={() => set({ source: s })}
                >
                  {SOURCE_LABEL[s]}
                </Chip>
              ))}
            </div>
          </fieldset>
          {filters.type === "bug" && (
            <>
              <label className="flex min-h-10 items-center justify-between gap-3 text-sm font-medium">
                Came back
                <Switch
                  checked={!!filters.came_back}
                  onCheckedChange={(v) => set({ came_back: v || undefined })}
                />
              </label>
              <label className="flex min-h-10 items-center justify-between gap-3 text-sm font-medium">
                Needs your check
                <Switch
                  checked={!!filters.needs_check}
                  onCheckedChange={(v) => set({ needs_check: v || undefined })}
                />
              </label>
            </>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() =>
              onChange({
                type: filters.type,
                status: "open",
                section: filters.section,
                q: filters.q,
              })
            }
          >
            Clear
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The inbox's list: Bugs and Ideas tabs with counts, a search, the filter
 * sheet, section chips with counts, and the reports in priority order. Copy
 * the whole filtered list, or select some to change or copy at once.
 */
export function BugList({
  filters,
  onFilters,
  activeId,
  onOpen,
}: {
  filters: BugFilters;
  onFilters: (f: BugFilters) => void;
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const q = useSettled(filters.q);
  const {
    data,
    isLoading,
    isError,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useBugList({ ...filters, q });
  const [filtering, setFiltering] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { copy, manual, clearManual } = useCopy();
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const counts = data?.pages[0]?.counts;
  const total = data?.pages[0]?.total ?? 0;
  // Only rows still in the list stay selected (a change or a filter can
  // move one out).
  const shownIds = new Set(items.map((r) => r.id));
  const chosen = [...picked].filter((id) => shownIds.has(id));
  const extra = extraFilters(filters);

  const change = (f: BugFilters) => {
    onFilters(f);
    setPicked(new Set());
  };
  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const copyRows = (rows: typeof items) =>
    copy(
      rows.length === 1 ? bugReport(rows[0]) : bugsReport(rows),
      rows.length === 1 ? "Copied" : `Copied ${rows.length}`,
    );
  const sectionTotal = counts
    ? Object.values(counts.sections).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className={cn("space-y-3", selecting && "pb-20 md:pb-0")}>
      <Segmented
        label="Bugs or ideas"
        value={filters.type}
        options={[
          {
            value: "bug",
            label: `Bugs${counts ? ` ${counts.bugs_open}` : ""}`,
          },
          {
            value: "idea",
            label: `Ideas${counts ? ` ${counts.ideas_open}` : ""}`,
          },
        ]}
        onChange={(type) => change({ type, status: "open", q: filters.q })}
      />

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search"
            placeholder="Search"
            value={filters.q ?? ""}
            onChange={(e) => onFilters({ ...filters, q: e.target.value })}
            className="pl-8"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFiltering(true)}
          aria-label="Filter"
        >
          <SlidersHorizontal aria-hidden />
          <span className="max-sm:sr-only">Filter</span>
          {extra > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
              {extra}
            </span>
          )}
        </Button>
        <Button
          variant={selecting ? "default" : "outline"}
          size="sm"
          aria-pressed={selecting}
          onClick={() => {
            setSelecting((s) => !s);
            setPicked(new Set());
          }}
        >
          <CheckSquare aria-hidden />
          <span className="max-sm:sr-only">Select</span>
        </Button>
      </div>

      <div
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0"
        role="group"
        aria-label="Sections"
      >
        <Chip
          on={!filters.section}
          onClick={() => change({ ...filters, section: undefined })}
        >
          All <span className="tabular-nums opacity-80">{sectionTotal}</span>
        </Chip>
        {SECTIONS.map((s) => {
          const n = counts?.sections[s] ?? 0;
          return (
            <Chip
              key={s}
              on={filters.section === s}
              onClick={() =>
                change({
                  ...filters,
                  section: filters.section === s ? undefined : s,
                })
              }
            >
              {SECTION_LABEL[s]}{" "}
              <span className="tabular-nums opacity-80">{n}</span>
            </Chip>
          );
        })}
      </div>

      <div className="flex min-h-8 items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {filters.status === "open"
            ? "Open"
            : filters.status === "all"
              ? "All"
              : STATUS_LABEL[filters.status]}
          {data ? ` · ${total}` : ""} · most important first
        </p>
        {items.length > 0 && !selecting && (
          <Button variant="ghost" size="sm" onClick={() => copyRows(items)}>
            <Copy aria-hidden />
            {items.length < total
              ? `Copy first ${items.length} for Claude`
              : `Copy ${items.length} for Claude`}
          </Button>
        )}
      </div>
      {manual !== null && <ManualCopy text={manual} onClose={clearManual} />}

      {isLoading ? (
        <Loader2
          className="mx-auto my-8 h-6 w-6 animate-spin text-muted-foreground"
          aria-label="Loading"
        />
      ) : isError ? (
        <div className="space-y-2 py-6 text-center">
          <p className="text-sm text-destructive">Couldn't load them.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {filters.status === "open" && !extra && !filters.q && !filters.section
            ? "Nothing open. All clear."
            : "Nothing matches."}
        </p>
      ) : (
        <ul
          className="-mx-3 space-y-0.5"
          aria-label={filters.type === "bug" ? "Bugs" : "Ideas"}
        >
          {items.map((row) => (
            <BugRow
              key={row.id}
              row={row}
              active={row.id === activeId}
              selecting={selecting}
              selected={picked.has(row.id)}
              onOpen={() => onOpen(row.id)}
              onToggle={() => toggle(row.id)}
            />
          ))}
        </ul>
      )}
      {hasNextPage && (
        <Button
          variant="outline"
          className="w-full"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
        >
          {isFetchingNextPage && (
            <Loader2 className="animate-spin" aria-hidden />
          )}
          Show more ({total - items.length} left)
        </Button>
      )}

      {selecting && (
        <BulkBar
          ids={chosen}
          type={filters.type}
          onCopy={() => copyRows(items.filter((r) => chosen.includes(r.id)))}
          onApplied={() => setPicked(new Set())}
          onDone={() => {
            setSelecting(false);
            setPicked(new Set());
          }}
        />
      )}
      <FilterSheet
        open={filtering}
        onOpenChange={setFiltering}
        filters={filters}
        onChange={change}
      />
    </div>
  );
}
