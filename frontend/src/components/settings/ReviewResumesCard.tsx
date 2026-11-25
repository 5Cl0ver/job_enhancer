import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useProfile, useUpdateProfile } from "@/hooks/useProfile";

/** "Look over Claude's résumé first" (spec 025): on by default. Off, Apply
 * with Claude goes straight from the résumé to the application. */
export function ReviewResumesCard() {
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  if (!profile) return null;
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 py-4">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor="review-resumes" className="text-sm font-medium">
            Look over Claude's résumé first
          </Label>
          <p className="text-xs text-muted-foreground">
            When Claude writes a résumé for an application, it waits for you to use it or ask for changes.
          </p>
          {update.isError && <p className="text-xs text-destructive">Couldn't save that. Try again.</p>}
        </div>
        <Switch
          id="review-resumes"
          checked={profile.review_resumes !== false}
          disabled={update.isPending}
          onCheckedChange={(on) => update.mutate({ review_resumes: on })}
        />
      </CardContent>
    </Card>
  );
}
