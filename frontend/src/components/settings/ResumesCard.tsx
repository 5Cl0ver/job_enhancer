import { useState } from "react";
import { Crown, FileText, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ResumeUpload } from "@/components/ai/ResumeUpload";
import { type ResumeRecord, useResumes } from "@/hooks/useAI";
import { useDeleteFact, useDeleteResume, useEditFact, useFacts, useSetMasterResume } from "@/hooks/useApply";
import { openOwnFile } from "@/lib/openFile";

function ResumeRow({ r, master }: { r: ResumeRecord; master: boolean }) {
  const setMaster = useSetMasterResume();
  const del = useDeleteResume();
  const made = !!r.document_id;
  return (
    <li className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        className="flex min-w-0 items-center gap-1.5 text-left text-sm hover:underline"
        onClick={() => openOwnFile(`/v1/ai/resumes/${r.id}/file`, r.filename)}
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{r.filename}</span>
        {master && <span className="shrink-0 rounded bg-primary/10 px-1.5 text-xs text-primary">Master</span>}
        {r.is_active && <span className="shrink-0 rounded bg-muted px-1.5 text-xs">Usual</span>}
      </button>
      <span className="flex shrink-0 gap-1">
        {!made && !master && (
          <Button size="sm" variant="ghost" className="gap-1" disabled={setMaster.isPending} onClick={() => setMaster.mutate(r.id)}>
            <Crown className="h-3.5 w-3.5" aria-hidden /> Make master
          </Button>
        )}
        {!r.is_active && !r.is_master && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={del.isPending}
            aria-label={`Delete ${r.filename}`}
            onClick={() => {
              if (window.confirm(`Delete ${r.filename}? Jobs that used it go back to your usual résumé.`)) del.mutate(r.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
      </span>
    </li>
  );
}

/**
 * Settings › Résumés (spec 022): the master résumé (the big "everything I've
 * done" one Claude tailors from), your others, and the ones Claude made for a
 * job, which can be deleted.
 */
export function ResumesCard() {
  const { data: resumes = [] } = useResumes();
  const own = resumes.filter((r) => !r.document_id);
  const made = resumes.filter((r) => r.document_id);
  const masterId = (own.find((r) => r.is_master) ?? own.find((r) => r.is_active))?.id;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Résumés</CardTitle>
        <CardDescription>
          Your <strong>master</strong> résumé is the big one with everything you've done. Claude writes each
          job's résumé from it. None picked? Your usual one is the master.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {own.length > 0 && (
          <ul className="divide-y">
            {own.map((r) => (
              <ResumeRow key={r.id} r={r} master={r.id === masterId} />
            ))}
          </ul>
        )}
        <ResumeUpload />
        {made.length > 0 && (
          <div>
            <p className="text-sm font-medium">Made for a job</p>
            <ul className="divide-y">
              {made.map((r) => (
                <ResumeRow key={r.id} r={r} master={false} />
              ))}
            </ul>
          </div>
        )}
        <FactsList />
      </CardContent>
    </Card>
  );
}

function FactRow({ id, question, answer }: { id: string; question: string; answer: string }) {
  const edit = useEditFact();
  const del = useDeleteFact();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(answer);
  return (
    <li className="space-y-1 py-2 text-sm">
      <p className="font-medium">{question}</p>
      {editing ? (
        <div className="space-y-2">
          <Textarea aria-label={`Answer to: ${question}`} value={text} rows={2} maxLength={1900} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!text.trim() || edit.isPending}
              onClick={() => edit.mutate({ id, answer: text.trim() }, { onSuccess: () => setEditing(false) })}
            >
              {edit.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <p className="whitespace-pre-wrap text-muted-foreground">{answer}</p>
          <span className="flex shrink-0">
            <Button size="sm" variant="ghost" aria-label={`Edit the answer to: ${question}`} onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              aria-label={`Delete: ${question}`}
              disabled={del.isPending}
              onClick={() => del.mutate(id)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </span>
        </div>
      )}
    </li>
  );
}

/** What you told Claude that your résumé doesn't say: used for every job. */
function FactsList() {
  const { data: facts = [] } = useFacts();
  return (
    <div>
      <p className="text-sm font-medium">Things you've told Claude</p>
      <p className="text-xs text-muted-foreground">
        Your answers to Claude's questions. Claude uses them for every job and never asks them again.
      </p>
      {facts.length ? (
        <ul className="divide-y">
          {facts.map((f) => (
            <FactRow key={f.id} {...f} />
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Nothing yet.</p>
      )}
    </div>
  );
}
