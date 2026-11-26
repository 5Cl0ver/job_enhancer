import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Segmented } from "@/components/bugs/BugForm";
import { StatusPill } from "@/components/bugs/BugRow";
import { useBugList } from "@/hooks/useBugReports";
import { type BugType, SECTION_LABEL } from "@/lib/bugs";

/** Pick another report (to link to, or to merge into), by search. */
export function ReportPicker({
  open,
  onOpenChange,
  title,
  hint,
  exclude,
  startType,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  hint: string;
  exclude: string[];
  startType: BugType;
  onPick: (id: string) => void;
}) {
  const [type, setType] = useState<BugType>(startType);
  const [q, setQ] = useState("");
  const { data, isLoading } = useBugList({ type, status: "all", q }, open);
  const rows = (data?.items ?? []).filter((r) => !exclude.includes(r.id));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{hint}</DialogDescription>
        </DialogHeader>
        <Segmented
          label="Bugs or ideas"
          value={type}
          options={[
            { value: "bug", label: "Bugs" },
            { value: "idea", label: "Ideas" },
          ]}
          onChange={setType}
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search reports"
            placeholder="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
        {isLoading ? (
          <Loader2
            className="mx-auto h-5 w-5 animate-spin text-muted-foreground"
            aria-label="Loading"
          />
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nothing found.
          </p>
        ) : (
          <ul className="-mx-2 max-h-80 overflow-y-auto">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(r.id)}
                  className="flex w-full flex-col items-start gap-1 rounded-md px-2 py-2 text-left active:bg-accent md:hover:bg-accent"
                >
                  <span className="line-clamp-2 text-sm font-medium">
                    {r.title}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusPill status={r.status} />
                    {SECTION_LABEL[r.section]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
