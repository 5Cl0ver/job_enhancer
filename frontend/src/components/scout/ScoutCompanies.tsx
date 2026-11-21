/**
 * Claude Scout → History: the local companies a "Local companies" search has
 * checked, with the openings Claude saw on each careers page (as links). Folded
 * away until opened; each one can be put first in line for the next run, or
 * never checked again. Hidden until there are any.
 */
import { useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { useCompanies, useUpdateCompany } from "@/hooks/useScout";
import { type Company, companyStatus } from "@/lib/scout";
import { Button } from "@/components/ui/button";

export function ScoutCompanies() {
  const { data: companies } = useCompanies();
  const [open, setOpen] = useState(false);
  if (!companies?.length) return null;
  const Icon = open ? ChevronDown : ChevronRight;
  const hiring = companies.filter((c) => c.last_result === "openings").length;

  return (
    <section className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 p-3 text-left hover:bg-muted/50"
      >
        <Icon
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">
            Local companies checked ({companies.length})
          </span>
          <span className="block text-sm text-muted-foreground">
            {hiring} had jobs listed last time. Each is checked again after a
            week.
          </span>
        </span>
      </button>
      {open && (
        <ul className="divide-y border-t">
          {companies.map((c) => (
            <CompanyRow key={c.id} company={c} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CompanyRow({ company: c }: { company: Company }) {
  const update = useUpdateCompany();
  const link = c.careers_url ?? c.website;
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-1.5 font-medium">
          <Building2
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1 hover:underline pointer-coarse:min-h-11"
            >
              <span className="truncate">{c.name}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
          ) : (
            <span className="truncate">{c.name}</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">{companyStatus(c)}</p>
        {!!c.last_openings?.length && <Openings openings={c.last_openings} />}
        {update.isError && (
          <p className="text-xs text-destructive">
            Couldn&apos;t change that. Try again.
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        {c.never_check ? (
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() => update.mutate({ id: c.id, never_check: false })}
          >
            Check again
          </Button>
        ) : (
          <>
            {!c.due && (
              <Button
                size="sm"
                variant="outline"
                disabled={update.isPending}
                onClick={() => update.mutate({ id: c.id, check_next: true })}
              >
                Check next run
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: c.id, never_check: true })}
            >
              Never check
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** The jobs a careers page listed, as Claude saw them, best fit first. */
function Openings({
  openings,
}: {
  openings: NonNullable<Company["last_openings"]>;
}) {
  const [all, setAll] = useState(false);
  const sorted = [...openings].sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1));
  const shown = all ? sorted : sorted.slice(0, 5);
  return (
    <div className="mt-1.5">
      <ul className="space-y-0.5">
        {shown.map((o) => (
          <li key={o.url} className="text-sm">
            <a
              href={o.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-2 hover:underline pointer-coarse:min-h-11"
            >
              <span className="min-w-0 break-words">{o.title}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
            {o.fit != null && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                fit {o.fit}/10
              </span>
            )}
          </li>
        ))}
      </ul>
      {sorted.length > shown.length && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline pointer-coarse:min-h-11"
          onClick={() => setAll(true)}
        >
          Show all {sorted.length}
        </button>
      )}
    </div>
  );
}
