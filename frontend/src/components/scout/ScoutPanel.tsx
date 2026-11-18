/**
 * The Claude Scout tab on Find Jobs: Claude in Chrome browses job boards and
 * local company sites like a person, and this app is its memory. It starts with
 * the user's resume types — every job Scout finds is tagged with one.
 */
import { ResumeTypes } from "@/components/scout/ResumeTypes";

export function ScoutPanel() {
  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Claude in Chrome searches LinkedIn, Indeed and small local company sites for you, and
        saves what fits straight into My Jobs — never the same job twice.
      </p>
      <ResumeTypes />
    </div>
  );
}
