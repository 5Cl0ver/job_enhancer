import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CoverLetterRow, NO_LETTER_YET, letterFileName } from "@/components/jobs/JobCoverLetterPicker";
import { useCoverLetters } from "@/hooks/useCoverLetters";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * Settings › Cover letters (spec 039), next to the résumés: every letter
 * Claude wrote, newest first, each the same row as on the job's page (View,
 * Download, Edit text). Which one a job uses is picked on the job's page.
 */
export function CoverLettersCard() {
  const { data } = useCoverLetters();
  const letters = data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cover letters</CardTitle>
        <CardDescription>
          Claude writes one when an application asks for it. Pick which one a job uses on the job's page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {letters.length ? (
          <ul className="divide-y" aria-label="Cover letters">
            {letters.map((l) => (
              <li key={l.id} className="py-2">
                <CoverLetterRow
                  id={l.id}
                  filename={letterFileName(l.company)}
                  sub={[l.job_title, day(l.created_at)].filter(Boolean).join(" · ")}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{NO_LETTER_YET}</p>
        )}
      </CardContent>
    </Card>
  );
}
