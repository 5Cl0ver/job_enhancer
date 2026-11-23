// "Write": a cover letter or a tailored résumé for one saved job, by the app's
// free AI or by the user's own Claude (we build the prompt; they paste the
// answer back). A tailored résumé is uploaded by the next Autofill.
import * as React from "react";
import { Bot, ClipboardCopy, Download, ExternalLink, FileText, Mail, Paperclip, PenLine, RotateCw, Save, Sparkles, X } from "lucide-react";
import { Alert, Button, Card, Field, Muted, SectionTitle, Segmented, Select, Textarea } from "@/ui";
import { copyText, hasClaudeTab, openClaude, openClaudeProject, pdfBlobUrl, send } from "@/lib/chrome";
import { downloadFilename } from "@/lib/context";
import { usePanel } from "@/lib/store";

type DocType = "cover_letter" | "resume";
type Engine = "nvidia" | "claude";
type Note = { tone: "info" | "success" | "warning" | "error"; text: string };

export function Write({ preferJob }: { preferJob: string | null }) {
  const { saved, signedOut, claudeUrl, staged, setStaged } = usePanel();
  const jobs = saved.jobs.filter((j) => j.job_listing_id);
  const [jobId, setJobId] = React.useState(preferJob || "");
  const [docType, setDocType] = React.useState<DocType>("cover_letter");
  const [engine, setEngine] = React.useState<Engine>("nvidia");
  const [busy, setBusy] = React.useState<"write" | "save" | "pdf" | null>(null);
  const [note, setNote] = React.useState<Note | null>(null);
  const [output, setOutput] = React.useState("");
  const [docId, setDocId] = React.useState<string | null>(null);
  const [prompt, setPrompt] = React.useState("");
  const [pasted, setPasted] = React.useState("");
  const [bridgeResumeId, setBridgeResumeId] = React.useState<string | null>(null);
  const [resumeFilename, setResumeFilename] = React.useState("");
  const [copied, setCopied] = React.useState<"prompt" | "output" | "failed" | null>(null);
  const outputRef = React.useRef<HTMLTextAreaElement>(null);

  // Default to the first saved job; keep the chosen one while it exists.
  React.useEffect(() => {
    if (!jobs.length) return;
    if (!jobId || !jobs.some((j) => j.job_listing_id === jobId)) setJobId(jobs[0].job_listing_id);
  }, [jobs, jobId]);

  // The job the tab beside the panel is about (or "Write for this job"):
  // follow it while nothing is being written.
  React.useEffect(() => {
    if (preferJob && !busy && !output && !prompt && jobs.some((j) => j.job_listing_id === preferJob)) {
      setJobId(preferJob);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferJob]);

  // Output belongs to one kind of document and one engine.
  const reset = () => {
    setOutput("");
    setDocId(null);
    setPrompt("");
    setPasted("");
    setNote(null);
  };

  async function stageAndPreview(id: string | null, filename: string) {
    if (!id) return;
    await setStaged(id, filename);
    const pdf = await send({ type: "getDocumentPdf", docId: id });
    if (pdf?.ok && pdf.b64) {
      const url = pdfBlobUrl(pdf.b64);
      chrome.tabs.create({ url });
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  const failed = (res: { error?: string } | null, fallback: string) => {
    if (res?.error === "NOT_SIGNED_IN") return signedOut();
    if (res?.error === "NO_RESUME") return setNote({ tone: "warning", text: "Upload a résumé in Job Enhancer (AI Apply) first." });
    setNote({ tone: "error", text: res?.error || fallback });
  };

  async function writeWithAi() {
    setBusy("write");
    setNote({ tone: "info", text: "Writing with AI, about 15 seconds…" });
    const res = await send({ type: "generateDocument", job_listing_id: jobId, docType });
    setBusy(null);
    if (!res?.ok || !res.content) return failed(res, "Couldn't write it. Try again.");
    setOutput(res.content);
    setDocId(res.docId || null);
    const file = res.resumeFilename || resumeFilename;
    if (res.resumeFilename) setResumeFilename(res.resumeFilename);
    if (docType === "resume") {
      await stageAndPreview(res.docId || null, downloadFilename(file, docType));
      setNote({ tone: "success", text: "Done. It opened for a look, and your next Autofill uploads it." });
    } else {
      setNote({ tone: "success", text: "Done. Copy it into the application." });
    }
  }

  async function draftWithClaude() {
    setBusy("write");
    setNote({ tone: "info", text: "Building your prompt…" });
    const res = await send({ type: "buildPrompt", job_listing_id: jobId, docType });
    setBusy(null);
    if (!res?.ok || !res.prompt) return failed(res, "Couldn't build the prompt. Try again.");
    setPrompt(res.prompt);
    setBridgeResumeId(res.resumeId || null);
    if (res.resumeFilename) setResumeFilename(res.resumeFilename);
    await copyText(res.prompt);
    // Résumé: always your Claude Project. Cover letter: stay in the chat you're in.
    const how = docType === "resume" ? await openClaudeProject(claudeUrl) : (await hasClaudeTab()) ? "copied" : await openClaude(claudeUrl);
    setNote({
      tone: "success",
      text:
        how === "copied"
          ? "Prompt copied. Paste it in your Claude chat, then paste Claude's answer below."
          : "Prompt copied and Claude is open. Paste it there, then paste Claude's answer below.",
    });
  }

  async function saveClaudeAnswer() {
    const content = pasted.trim();
    if (!content) return setNote({ tone: "warning", text: "Paste Claude's answer first." });
    setBusy("save");
    const res = await send({ type: "saveManualDocument", job_listing_id: jobId, docType, content, resume_id: bridgeResumeId });
    setBusy(null);
    if (!res?.ok) return failed(res, "Couldn't save it. Try again.");
    setDocId(res.docId || null);
    setOutput(content);
    setPasted("");
    setPrompt("");
    if (docType === "resume") {
      await stageAndPreview(res.docId || null, downloadFilename(resumeFilename, docType));
      setNote({ tone: "success", text: "Saved. It opened for a look, and your next Autofill uploads it." });
    } else {
      setNote({ tone: "success", text: "Saved. Copy it into the application." });
    }
  }

  async function downloadPdf() {
    if (!docId) return;
    setBusy("pdf");
    const res = await send({ type: "getDocumentPdf", docId });
    setBusy(null);
    if (!res?.ok || !res.b64) return setNote({ tone: "error", text: "Couldn't make the PDF. Try again." });
    const url = pdfBlobUrl(res.b64);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadFilename(resumeFilename, docType);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function copy(what: "prompt" | "output") {
    const ok = await copyText(what === "prompt" ? prompt : output);
    if (!ok && what === "output") outputRef.current?.select(); // so Ctrl+C works
    setCopied(ok ? what : "failed");
    setTimeout(() => setCopied(null), 2200);
  }

  if (!saved.loaded && saved.error) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <SectionTitle>Your jobs didn't load</SectionTitle>
        <Muted>Open My jobs and press Retry, then come back here.</Muted>
      </div>
    );
  }

  if (saved.loaded && !jobs.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <SectionTitle>Save a job first</SectionTitle>
        <Muted>Then write a cover letter or a tailored résumé for it here.</Muted>
      </div>
    );
  }

  const what = docType === "resume" ? "résumé" : "cover letter";
  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>Write for a job</SectionTitle>
      <Card className="flex flex-col gap-3">
        <Field label="Job">
          {(id) => (
            <Select id={id} value={jobId} disabled={!!busy} onChange={(e) => { setJobId(e.target.value); reset(); }}>
              {jobs.map((j) => (
                <option key={j.job_listing_id} value={j.job_listing_id}>
                  {[j.title, j.company].filter(Boolean).join(" · ")}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Segmented
          label="What to write"
          disabled={!!busy}
          value={docType}
          onChange={(v) => { setDocType(v); reset(); }}
          options={[
            { value: "cover_letter", label: "Cover letter", icon: <Mail /> },
            { value: "resume", label: "Tailored résumé", icon: <FileText /> },
          ]}
        />
        <Segmented
          label="Who writes it"
          disabled={!!busy}
          value={engine}
          onChange={(v) => { setEngine(v); reset(); }}
          options={[
            { value: "nvidia", label: "Free AI", icon: <Bot /> },
            { value: "claude", label: "My Claude", icon: <Sparkles /> },
          ]}
        />
        <Button onClick={engine === "claude" ? draftWithClaude : writeWithAi} busy={busy === "write"} disabled={!jobId} className="w-full">
          {busy !== "write" && (engine === "claude" ? <Sparkles /> : <PenLine />)}
          {engine === "claude" ? `Draft my ${what} with Claude` : `Write my ${what}`}
        </Button>
        {engine === "claude" && <Muted>Uses your own Claude: we copy the prompt, you paste Claude's answer back here.</Muted>}
      </Card>

      {note && <Alert tone={note.tone}>{note.text}</Alert>}

      {engine === "claude" && !output && (
        <Card className="flex flex-col gap-2.5">
          <SectionTitle className="text-sm">Claude's answer</SectionTitle>
          <Textarea aria-label="Claude's answer" rows={7} placeholder="Paste what Claude wrote, then save it to get a formatted PDF." value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveClaudeAnswer} busy={busy === "save"} className="flex-1">
              {busy !== "save" && <Save />}Save and make PDF
            </Button>
            {prompt && (
              <Button variant="outline" onClick={() => copy("prompt")}>
                <ClipboardCopy />
                {copied === "prompt" ? "Copied" : copied === "failed" ? "Press Ctrl+C" : "Copy prompt"}
              </Button>
            )}
            <Button variant="ghost" onClick={() => openClaude(claudeUrl)}>
              <ExternalLink />
              Open Claude
            </Button>
          </div>
        </Card>
      )}

      {output && (
        <Card className="flex flex-col gap-2.5">
          <SectionTitle className="text-sm">Your {what}</SectionTitle>
          <Textarea ref={outputRef} aria-label={`Your ${what}`} rows={10} value={output} onChange={(e) => setOutput(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => copy("output")}>
              <ClipboardCopy />
              {copied === "output" ? "Copied" : copied === "failed" ? "Selected: press Ctrl+C" : "Copy"}
            </Button>
            <Button variant="outline" onClick={downloadPdf} busy={busy === "pdf"} disabled={!docId}>
              {busy !== "pdf" && <Download />}PDF
            </Button>
            <Button variant="ghost" onClick={engine === "claude" ? () => { setOutput(""); setDocId(null); } : writeWithAi} busy={busy === "write"}>
              {busy !== "write" && <RotateCw />}
              {engine === "claude" ? "Draft again" : "Write again"}
            </Button>
          </div>
        </Card>
      )}

      {staged && (
        <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs">
          <Paperclip className="size-3.5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">
            <b className="break-all">{staged}</b> is uploaded by your next Autofill.
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => setStaged(null)} aria-label="Use my usual résumé instead" title="Use my usual résumé instead">
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}

