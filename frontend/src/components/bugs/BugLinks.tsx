import { useState } from "react";
import { Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/bugs/BugRow";
import { ReportPicker } from "@/components/bugs/ReportPicker";
import { useLinkBug, useUnlinkBug } from "@/hooks/useBugReports";
import type { BugDetail } from "@/lib/bugs";

/** "Related to", both ways: an idea can link to the bugs it would solve. */
export function BugLinks({
  report,
  onOpen,
}: {
  report: BugDetail;
  onOpen: (id: string) => void;
}) {
  const link = useLinkBug();
  const unlink = useUnlinkBug();
  const [picking, setPicking] = useState(false);
  return (
    <section aria-labelledby={`links-${report.id}`} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`links-${report.id}`} className="text-sm font-semibold">
          Related
        </h3>
        <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>
          <Link2 aria-hidden /> Link one
        </Button>
      </div>
      {report.links.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {report.links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 pl-3">
              <button
                type="button"
                onClick={() => onOpen(l.id)}
                className="min-w-0 flex-1 py-2 text-left text-sm active:opacity-70"
              >
                <span className="line-clamp-1">{l.title}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {l.type === "bug" ? "Bug" : "Idea"}{" "}
                  <StatusPill status={l.status} />
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Unlink ${l.title}`}
                onClick={() => unlink.mutate({ id: report.id, otherId: l.id })}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {(link.isError || unlink.isError) && (
        <p role="alert" className="text-xs text-destructive">
          {link.isError
            ? "Couldn't link them. Try again."
            : "Couldn't unlink them. Try again."}
        </p>
      )}
      <ReportPicker
        open={picking}
        onOpenChange={setPicking}
        title="Link a report"
        hint="Pick one that's related to this one."
        startType={report.type === "idea" ? "bug" : report.type}
        exclude={[report.id, ...report.links.map((l) => l.id)]}
        onPick={(otherId) => {
          link.mutate({ id: report.id, otherId });
          setPicking(false);
        }}
      />
    </section>
  );
}
