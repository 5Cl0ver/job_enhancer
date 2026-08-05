import { Link } from "react-router-dom";
import { Target, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMatch } from "@/hooks/useMatch";

/**
 * Resume ↔ job keyword coverage: "your resume covers 8 of 12 skills this job
 * names". Transparent by design — the matched/missing chips tell the user
 * exactly what to add, and the missing list is the input to AI tailoring.
 */
export function MatchScore({ jobId }: { jobId: string }) {
  const { data, isLoading } = useMatch(jobId);

  if (isLoading || !data) return null;

  // No description → nothing to match against; stay quiet rather than guess.
  if (!data.has_description) return null;

  if (!data.has_resume) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          <Target className="mr-1.5 inline h-4 w-4 align-text-bottom" aria-hidden />
          <Link to="/ai-apply" className="underline hover:text-foreground">
            Upload your resume
          </Link>{" "}
          to see how well it matches this job.
        </CardContent>
      </Card>
    );
  }

  const total = data.matched.length + data.missing.length;
  if (total === 0) return null; // description names no known skills

  const tone =
    data.score >= 70 ? "text-green-600" : data.score >= 40 ? "text-amber-600" : "text-red-600";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-1.5">
            <Target className="h-4 w-4" aria-hidden />
            Resume match
          </span>
          <span className={tone}>
            {data.score}%{" "}
            <span className="text-xs font-normal text-muted-foreground">
              ({data.matched.length}/{total} keywords)
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pb-4">
        {/* Coverage bar */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${
              data.score >= 70 ? "bg-green-500" : data.score >= 40 ? "bg-amber-500" : "bg-red-500"
            }`}
            style={{ width: `${data.score}%` }}
          />
        </div>

        <div className="flex flex-wrap gap-1.5 pt-1">
          {data.matched.map((k) => (
            <Badge key={k} variant="secondary" className="gap-1 text-xs font-normal">
              <Check className="h-3 w-3 text-green-600" aria-hidden />
              {k}
            </Badge>
          ))}
          {data.missing.map((k) => (
            <Badge
              key={k}
              variant="outline"
              className="gap-1 text-xs font-normal text-muted-foreground"
            >
              <X className="h-3 w-3 text-red-500" aria-hidden />
              {k}
            </Badge>
          ))}
        </div>
        {data.missing.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Missing keywords are what to emphasize in a tailored resume or cover letter.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
