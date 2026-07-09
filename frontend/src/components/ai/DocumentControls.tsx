"use client";

import { useState } from "react";
import { Download, Copy, RefreshCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GeneratedDocument } from "@/types/api";

interface DocumentControlsProps {
  doc: GeneratedDocument;
  onRegenerate?: (emphasis: string) => void;
  isRegenerating?: boolean;
}

export function DocumentControls({ doc, onRegenerate, isRegenerating }: DocumentControlsProps) {
  const [emphasis, setEmphasis] = useState("");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = doc.edited_content ?? doc.content;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    window.open(`${apiBase}/api/v1/ai/documents/${doc.id}/pdf`, "_blank");
  };

  return (
    <div className="flex flex-col gap-3">
      {onRegenerate && (
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="regen-emphasis" className="text-xs">
              Emphasis for regeneration (optional)
            </Label>
            <Input
              id="regen-emphasis"
              placeholder="e.g. highlight Python and FastAPI experience"
              value={emphasis}
              onChange={(e) => setEmphasis(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRegenerate(emphasis)}
            disabled={isRegenerating}
            className="mt-auto h-8 gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRegenerating ? "animate-spin" : ""}`} />
            Regenerate
          </Button>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied!" : "Copy"}
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownload} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />
          Download PDF
        </Button>
      </div>
    </div>
  );
}
