"use client";

import { useState } from "react";
import { Bot, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { ResumeUpload } from "@/components/ai/ResumeUpload";
import { GeneratedDocViewer } from "@/components/ai/GeneratedDocViewer";
import { DocumentControls } from "@/components/ai/DocumentControls";
import { useResumes, useGenerateDocument, useGeneratedDocument } from "@/hooks/useAI";
import { useSavedJobs } from "@/hooks/useSavedJobs";
import type { GeneratedDocument } from "@/types/api";

export default function AIApplyPage() {
  const { data: resumes = [] } = useResumes();
  const { data: savedJobs = [] } = useSavedJobs();
  const generateDoc = useGenerateDocument();

  const activeResume = resumes.find((r) => r.is_active);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [resumeDocId, setResumeDocId] = useState<string | null>(null);
  const [coverDocId, setCoverDocId] = useState<string | null>(null);

  const { data: resumeDoc } = useGeneratedDocument(resumeDocId);
  const { data: coverDoc } = useGeneratedDocument(coverDocId);

  const isGenerating = generateDoc.isPending;

  const handleGenerate = async (type: "resume" | "cover_letter") => {
    if (!activeResume) return;
    generateDoc.mutate(
      {
        resume_id: activeResume.id,
        document_type: type,
        job_listing_id: selectedJobId || undefined,
      },
      {
        onSuccess: (doc: GeneratedDocument) => {
          if (type === "resume") setResumeDocId(doc.id);
          else setCoverDocId(doc.id);
        },
      },
    );
  };

  const hasAIError = generateDoc.isError;

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">AI Quick Apply</h1>
        <p className="text-sm text-muted-foreground">
          Upload your resume, select a job, and get AI-tailored documents in seconds.
        </p>
      </div>

      {hasAIError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            AI service is temporarily unavailable. All other features remain accessible.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Left: Setup */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your Resume</CardTitle>
            </CardHeader>
            <CardContent>
              <ResumeUpload />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Target Job (optional)</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a saved job…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No job selected</SelectItem>
                  {savedJobs.map((sj) => (
                    <SelectItem key={sj.job_listing_id} value={sj.job_listing_id}>
                      {sj.job_listing.title} — {sj.job_listing.company}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button
              className="flex-1 gap-2"
              disabled={!activeResume || isGenerating}
              onClick={() => handleGenerate("resume")}
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
              Tailor Resume
            </Button>
            <Button
              variant="outline"
              className="flex-1 gap-2"
              disabled={!activeResume || isGenerating}
              onClick={() => handleGenerate("cover_letter")}
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
              Cover Letter
            </Button>
          </div>

          {!activeResume && (
            <p className="text-xs text-muted-foreground">
              Upload a resume above to enable document generation.
            </p>
          )}
        </div>

        {/* Right: Documents */}
        <div className="space-y-4">
          {(resumeDoc || coverDoc) ? (
            <>
              <GeneratedDocViewer resumeDoc={resumeDoc} coverLetterDoc={coverDoc} />
              <Separator />
              {resumeDoc && (
                <DocumentControls
                  doc={resumeDoc}
                  onRegenerate={() => handleGenerate("resume")}
                  isRegenerating={isGenerating}
                />
              )}
              {coverDoc && !resumeDoc && (
                <DocumentControls
                  doc={coverDoc}
                  onRegenerate={() => handleGenerate("cover_letter")}
                  isRegenerating={isGenerating}
                />
              )}
            </>
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border border-dashed">
              <div className="text-center text-muted-foreground">
                <Bot className="mx-auto mb-2 h-10 w-10 opacity-40" />
                <p className="text-sm">Generated documents will appear here</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
