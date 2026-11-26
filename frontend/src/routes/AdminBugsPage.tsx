import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Inbox, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { BugDetail } from "@/components/bugs/BugDetail";
import { BugList, START } from "@/components/bugs/BugList";
import { useIsPhone } from "@/hooks/useIsPhone";
import { useProfile } from "@/hooks/useProfile";
import type { BugFilters } from "@/lib/bugs";

/**
 * Bugs & ideas (spec 032): every bug and idea in one place, for the owner.
 * A list with tabs, sections, filters and search; the open report is a side
 * panel on a computer and a sheet on a phone (`?id=` in the address, so a
 * report can be linked to and Back closes it).
 */
export default function AdminBugsPage() {
  const { data: profile, isLoading } = useProfile();
  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2
          className="h-8 w-8 animate-spin text-muted-foreground"
          aria-label="Loading"
        />
      </div>
    );
  }
  if (!profile || profile.role !== "admin") return <Navigate to="/" replace />;
  return <BugsInbox />;
}

function BugsInbox() {
  const phone = useIsPhone();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<BugFilters>(START);
  const id = params.get("id");
  const open = (next: string | null) =>
    setParams(next ? { id: next } : {}, { replace: !!id });

  return (
    <div className="mx-auto max-w-6xl space-y-4 md:px-4 md:py-2">
      <div className="flex items-center gap-3 max-md:hidden">
        <Link
          to="/admin"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Back to Admin"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Bugs &amp; ideas</h1>
      </div>
      <div className="md:grid md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] md:items-start md:gap-6">
        <BugList
          filters={filters}
          onFilters={setFilters}
          activeId={id}
          onOpen={(next) => open(next)}
        />
        {!phone && (
          <aside
            aria-label="Report"
            className="sticky top-6 max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-xl border bg-card p-5"
          >
            {id ? (
              <BugDetail
                key={id}
                id={id}
                onOpen={(next) => open(next)}
                onGone={() => open(null)}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8" aria-hidden />
                Pick one to see all of it.
              </div>
            )}
          </aside>
        )}
      </div>
      {phone && (
        <Dialog open={!!id} onOpenChange={(o) => !o && open(null)}>
          <DialogContent>
            <DialogTitle className="sr-only">Report</DialogTitle>
            <DialogDescription className="sr-only">
              Everything about this report.
            </DialogDescription>
            {id && (
              <BugDetail
                key={id}
                id={id}
                onOpen={(next) => open(next)}
                onGone={() => open(null)}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
