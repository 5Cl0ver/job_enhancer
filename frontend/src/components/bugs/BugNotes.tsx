import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ago } from "@/components/bugs/BugRow";
import { useAddBugNote } from "@/hooks/useBugReports";
import type { BugEvent } from "@/lib/bugs";

export const WHO: Record<BugEvent["by"], string> = {
  owner: "You",
  claude: "Claude",
  app: "The app",
};

/** Short dated notes on a report, by the owner or Claude. */
export function BugNotes({ id, events }: { id: string; events: BugEvent[] }) {
  const add = useAddBugNote();
  const [text, setText] = useState("");
  const notes = events.filter((e) => e.kind === "note");
  return (
    <section aria-labelledby={`notes-${id}`} className="space-y-2">
      <h3 id={`notes-${id}`} className="text-sm font-semibold">
        Notes
      </h3>
      {notes.length > 0 && (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-muted/60 px-3 py-2">
              <p className="whitespace-pre-wrap break-words text-sm">
                {String(n.data.text ?? "")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {WHO[n.by]} · <time dateTime={n.at}>{ago(n.at)}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          add.mutate(
            { id, text: text.trim() },
            { onSuccess: () => setText("") },
          );
        }}
      >
        <Textarea
          aria-label="Add a note"
          placeholder="Add a note"
          value={text}
          maxLength={1000}
          rows={2}
          onChange={(e) => setText(e.target.value)}
        />
        {text.trim() && (
          <Button type="submit" size="sm" disabled={add.isPending}>
            {add.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Add note
          </Button>
        )}
        {add.isError && (
          <p className="text-xs text-destructive">
            Couldn't save the note. Try again.
          </p>
        )}
      </form>
    </section>
  );
}
