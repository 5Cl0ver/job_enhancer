"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Cpu, Clock } from "lucide-react";
import { useUpdateDocument } from "@/hooks/useAI";
import type { GeneratedDocument } from "@/types/api";

interface GeneratedDocViewerProps {
  resumeDoc?: GeneratedDocument | null;
  coverLetterDoc?: GeneratedDocument | null;
}

function DocEditor({ doc }: { doc: GeneratedDocument }) {
  const [value, setValue] = useState(doc.edited_content ?? doc.content);
  const update = useUpdateDocument();

  const handleBlur = () => {
    if (value !== (doc.edited_content ?? doc.content)) {
      update.mutate({ id: doc.id, edited_content: value });
    }
  };

  return (
    <div className="space-y-2">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        className="min-h-[400px] font-mono text-sm"
        aria-label="Edit generated document"
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{value.length} characters</span>
        {update.isPending && <span className="text-primary">Saving…</span>}
        {update.isSuccess && <span className="text-green-600">Saved</span>}
      </div>

      {/* AI Transparency Indicator — Constitution Principle III */}
      {(doc.model_used || doc.generation_ms) && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {doc.model_used && (
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              <span>Model: <Badge variant="secondary" className="text-xs">{doc.model_used}</Badge></span>
            </span>
          )}
          {doc.generation_ms && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Generated in {(doc.generation_ms / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function GeneratedDocViewer({ resumeDoc, coverLetterDoc }: GeneratedDocViewerProps) {
  if (!resumeDoc && !coverLetterDoc) return null;

  return (
    <Tabs defaultValue={resumeDoc ? "resume" : "cover_letter"}>
      <TabsList>
        {resumeDoc && <TabsTrigger value="resume">Tailored Resume</TabsTrigger>}
        {coverLetterDoc && <TabsTrigger value="cover_letter">Cover Letter</TabsTrigger>}
      </TabsList>
      {resumeDoc && (
        <TabsContent value="resume">
          <DocEditor doc={resumeDoc} />
        </TabsContent>
      )}
      {coverLetterDoc && (
        <TabsContent value="cover_letter">
          <DocEditor doc={coverLetterDoc} />
        </TabsContent>
      )}
    </Tabs>
  );
}
