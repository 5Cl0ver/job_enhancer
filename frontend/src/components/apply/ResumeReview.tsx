import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ResumeForJob } from "@/components/apply/ResumeForJob";
import { PdfViewer } from "@/components/common/PdfViewer";
import { usePostMessage, useResumeDecision } from "@/hooks/useApply";
import { useProfile, useUpdateProfile } from "@/hooks/useProfile";
import { api } from "@/lib/api";
import type { ApplyRun } from "@/lib/apply";

const ASK = "What should I change on this résumé for this job?";

/**
 * "Look over your résumé" (spec 025): Claude wrote the job's résumé and waits.
 * Use it, ask for a change, ask Claude what it would change (the answer comes
 * in the conversation), or edit the text yourself. Nothing is filled until
 * you say Use it. With Use it, "Also write a cover letter" asks Claude for
 * one too (spec 040); it shows on this page next to the résumé.
 */
export function ResumeReview({ run }: { run: ApplyRun }) {
  const decide = useResumeDecision();
  const post = usePostMessage();
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState("");
  // "Also write a cover letter" (spec 040): only when the job has none yet.
  const [letter, setLetter] = useState(false);
  const offerLetter = !run.cover_letter && !run.cover_letter_written;
  const decided = !!run.resume_check?.decision;
  const round = run.resume_check?.round ?? 1;
  // The résumé right here (spec 025): each round is Claude's newest version.
  const pdf = useQuery({
    queryKey: ["resume-look", run.resume_id, round],
    queryFn: () => api.getBlob(`/v1/ai/resumes/${run.resume_id}/file`),
    enabled: !!run.resume_id,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  return (
    <div className="space-y-4">
      <p className="text-sm">
        {round > 1 ? "Claude changed it. " : "Claude wrote this résumé for the job. "}
        Look it over: nothing is filled until you say Use it.
      </p>
      {pdf.data ? (
        <PdfViewer blob={pdf.data} filename="Résumé for this job.pdf" className="h-[65dvh] rounded-md border" />
      ) : pdf.isError ? (
        <p className="text-sm text-muted-foreground">Couldn't show it here. Use View below.</p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening your résumé…
        </p>
      )}
      <ResumeForJob run={run} />

      {!decided && !changing && offerLetter && (
        <label className="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={letter}
            onChange={(e) => setLetter(e.target.checked)}
          />
          Also write a cover letter for this job
        </label>
      )}
      {!decided && !changing && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="gap-1.5 sm:flex-1"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ runId: run.id, decision: "use", coverLetter: offerLetter && letter })}
          >
            {decide.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
            Use it
          </Button>
          <Button variant="outline" className="sm:flex-1" onClick={() => setChanging(true)}>
            Change something
          </Button>
        </div>
      )}

      {!decided && changing && (
        <div className="space-y-2">
          <Textarea
            aria-label="What should Claude change?"
            placeholder="For example: lead with Intune, cut the projects"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-24"
          />
          <div className="flex gap-2">
            <Button
              disabled={!note.trim() || decide.isPending}
              className="gap-1.5"
              onClick={() =>
                decide.mutate(
                  { runId: run.id, decision: "change", note: note.trim() },
                  { onSuccess: () => setChanging(false) },
                )
              }
            >
              {decide.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Send to Claude
            </Button>
            <Button variant="ghost" onClick={() => setChanging(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {decide.isError && <p className="text-sm text-destructive">Couldn't send that. Try again.</p>}

      {!decided && (
        <div className="space-y-2 rounded-md bg-muted/60 p-3">
          <p className="text-sm">Not sure? Ask Claude. Its answer shows in the conversation below.</p>
          <Button
            variant="outline"
            size="sm"
            className="h-auto gap-1.5 whitespace-normal py-1.5 text-left"
            disabled={post.isPending}
            onClick={() => post.mutate({ runId: run.id, text: ASK })}
          >
            <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {ASK}
          </Button>
          {post.isSuccess && <p className="text-xs text-muted-foreground">Sent. Claude answers in a moment.</p>}
        </div>
      )}

      {profile && profile.review_resumes !== false && (
        <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4"
            disabled={update.isPending}
            onChange={(e) => e.target.checked && update.mutate({ review_resumes: false })}
          />
          Don't ask me next time (change it in Settings)
        </label>
      )}
    </div>
  );
}
