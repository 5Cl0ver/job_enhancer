import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Copy to the clipboard; when the browser blocks it, the text is kept so
 * `ManualCopy` can show it to copy by hand. */
export function useCopy() {
  const [manual, setManual] = useState<string | null>(null);
  const copy = useCallback(async (text: string, done = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      setManual(null);
      toast.success(done);
    } catch {
      setManual(text);
    }
  }, []);
  return { copy, manual, clearManual: () => setManual(null) };
}

/** When the clipboard is blocked: the text, selected, to copy by hand. */
export function ManualCopy({
  text,
  onClose,
}: {
  text: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.select(), [text]);
  return (
    <div className="space-y-2 rounded-lg border border-primary/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Couldn't copy. Select it all and copy it by hand.
        </p>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close"
        >
          <X aria-hidden />
        </Button>
      </div>
      <textarea
        ref={ref}
        readOnly
        aria-label="Text to copy for Claude"
        value={text}
        rows={8}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-md border bg-background p-2 font-mono text-xs"
      />
    </div>
  );
}
