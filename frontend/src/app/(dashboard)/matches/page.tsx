"use client";

import Link from "next/link";
import { BellOff, CheckCheck, Inbox, Loader2, Trash2 } from "lucide-react";
import {
  useDeleteSavedSearch,
  useMarkMatchesSeen,
  useNewMatches,
} from "@/hooks/useSavedSearches";
import { JobCard } from "@/components/jobs/JobCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function MatchesPage() {
  const { data, isLoading, isError } = useNewMatches();
  const markSeen = useMarkMatchesSeen();
  const deleteSearch = useDeleteSavedSearch();

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">New Matches</h1>
          <p className="text-sm text-muted-foreground">
            Fresh results from your saved searches, checked daily.
          </p>
        </div>
        {data && data.total_new > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markSeen.mutate()}
            disabled={markSeen.isPending}
            className="gap-1.5"
          >
            {markSeen.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <CheckCheck className="h-3.5 w-3.5" aria-hidden />
            )}
            Mark all as seen
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-lg" />
          ))}
        </div>
      ) : isError || !data ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-sm text-destructive">
          Failed to load your matches. Please try again.
        </div>
      ) : data.matches.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <BellOff className="h-12 w-12 text-muted-foreground/50" aria-hidden />
          <p className="text-lg font-medium">No saved searches yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Run a search and click &quot;Save this search&quot; — new matching
            jobs will be waiting here every day.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/search">Go to Search</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {data.matches.map(({ search, new_jobs, new_count }) => (
            <section key={search.id} aria-label={search.name}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Inbox
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden
                  />
                  <h2 className="font-semibold">{search.name}</h2>
                  {new_count > 0 && (
                    <Badge variant="secondary">
                      {new_count} new
                    </Badge>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete saved search ${search.name}`}
                  onClick={() => deleteSearch.mutate(search.id)}
                  className="h-7 text-xs text-muted-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>

              {new_jobs.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Nothing new since your last visit.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {new_jobs.map((job) => (
                    <JobCard key={job.id} job={job} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
