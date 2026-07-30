"use client";

import { useState } from "react";
import { BookmarkX } from "lucide-react";
import { AddJobDialog } from "@/components/jobs/AddJobDialog";
import { CollectionSidebar } from "@/components/jobs/CollectionSidebar";
import { JobCard } from "@/components/jobs/JobCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSavedJobs, useUnsaveJob } from "@/hooks/useSavedJobs";

export default function SavedPage() {
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const { data: savedJobs = [], isLoading, isError } = useSavedJobs({
    collectionId: selectedCollection ?? undefined,
  });
  const unsaveJob = useUnsaveJob();

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Saved Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Organize your saved listings into collections.
          </p>
        </div>
        <AddJobDialog />
      </div>

      <div className="flex gap-6">
        <CollectionSidebar
          selectedId={selectedCollection}
          onSelect={setSelectedCollection}
        />

        <main className="flex-1 min-w-0">
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-52 rounded-lg" />
              ))}
            </div>
          ) : isError ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-sm text-destructive">
              Failed to load saved jobs.
            </div>
          ) : savedJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <BookmarkX className="h-12 w-12 text-muted-foreground/50" />
              <p className="text-lg font-medium">No saved jobs yet</p>
              <p className="text-sm text-muted-foreground">
                Search for jobs and save the ones you like.
              </p>
              <Button variant="outline" asChild>
                <a href="/search">Find jobs</a>
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {savedJobs.map((sj) => (
                <JobCard
                  key={sj.id}
                  job={sj.job_listing}
                  isSaved
                  onSave={() => unsaveJob.mutate(sj.id)}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
