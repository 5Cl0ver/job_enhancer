import { useState } from "react";
import { Check, Copy, Laptop, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * For a phone (spec 019, R12): Job Catcher only runs in a computer's Chrome,
 * so send yourself the link to open it there later.
 */
export function ShareJobCatcherCard() {
  const link = `${window.location.origin}/job-catcher`;
  const share = async () => {
    try {
      await navigator.share({ title: "Get Job Catcher", url: link });
    } catch {
      // closed the share sheet
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
      <p className="flex items-center gap-2 text-sm">
        <Laptop className="h-4 w-4" /> Job Catcher runs in Chrome on a computer.
      </p>
      <p className="text-sm text-muted-foreground">Send yourself the link to open it there later.</p>
      <div className="flex gap-2">
        {typeof navigator !== "undefined" && "share" in navigator && (
          <Button onClick={share} className="gap-2">
            <Share2 className="h-4 w-4" /> Share link
          </Button>
        )}
        <CopyButton text={link} label="Copy link" />
      </div>
    </div>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2 self-start"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("Couldn't copy. Select it and copy by hand.");
        }
      }}
    >
      {done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {done ? "Copied" : label}
    </Button>
  );
}
