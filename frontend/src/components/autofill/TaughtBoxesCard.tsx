import { useMemo, useState } from "react";
import { Check, Loader2, MousePointerClick, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useEditTaughtBox,
  useForgetTaughtBox,
  useTaughtBoxes,
  type TaughtBox,
} from "@/hooks/useTaughtBoxes";

/** Friendly names for the profile answers a box can be taught (Job Catcher's list). */
const PROFILE_NAMES: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name",
  preferred_name: "Preferred name",
  email: "Email",
  phone: "Phone",
  address_line1: "Street address",
  address_line2: "Address line 2",
  city: "City",
  state: "State",
  postal_code: "Zip / postal code",
  country: "Country",
  location: "City, State",
  linkedin_url: "LinkedIn",
  github_url: "GitHub",
  portfolio_url: "Website / portfolio",
  current_title: "Current job title",
  current_company: "Current company",
  school: "School",
  degree: "Degree",
  field_of_study: "Field of study",
  graduation_year: "Graduation year",
  desired_salary: "Desired salary",
  notice_period: "Notice period",
};

/**
 * "Boxes you taught": every box the user pointed at in Job Catcher and told
 * what goes there, grouped by site. A typed answer can be changed in place;
 * any box can be removed (Job Catcher then reads it like any other box).
 */
export function TaughtBoxesCard() {
  const { data: boxes = [], isLoading } = useTaughtBoxes();
  const bySite = useMemo(() => {
    const m = new Map<string, TaughtBox[]>();
    for (const b of boxes) {
      if (!m.has(b.site)) m.set(b.site, []);
      m.get(b.site)!.push(b);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [boxes]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MousePointerClick className="h-4 w-4 text-primary" /> Boxes you taught
          {boxes.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({boxes.length})</span>
          )}
        </CardTitle>
        <CardDescription>
          Boxes you pointed at in Job Catcher and told what goes there. They fill by
          themselves on that site. Change an answer or remove a box anytime.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && boxes.length === 0 && (
          <p className="text-sm text-muted-foreground">
            None yet. When Job Catcher misses a box, press <b>Point at a box</b> in its
            side panel, click the box, and say what goes there.
          </p>
        )}
        {bySite.map(([site, items]) => (
          <section key={site} aria-label={site} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {site}
            </h3>
            <ul className="space-y-2.5">
              {items.map((b) => (
                <TaughtRow key={b.id} box={b} />
              ))}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

function TaughtRow({ box }: { box: TaughtBox }) {
  const edit = useEditTaughtBox();
  const forget = useForgetTaughtBox();
  const [value, setValue] = useState(box.answer ?? "");
  const [saved, setSaved] = useState(false);
  const changed = box.answer != null && value.trim() !== box.answer && value.trim() !== "";
  return (
    <li className="rounded-lg border bg-card p-3">
      <p className="mb-1.5 text-sm font-medium leading-snug">{box.label || "A box"}</p>
      {box.profile_key ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Fills with your profile's </span>
          <b className="font-medium">{PROFILE_NAMES[box.profile_key] ?? box.profile_key}</b>
        </p>
      ) : (
        <textarea
          aria-label={`Answer for ${box.label || "this box"} on ${box.site}`}
          className="w-full min-h-[40px] resize-y rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          rows={1}
          maxLength={2000}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        {saved && (
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        {box.profile_key == null && (
          <Button
            size="sm"
            variant="outline"
            disabled={!changed || edit.isPending}
            onClick={() =>
              edit.mutate(
                { id: box.id, answer: value.trim() },
                {
                  onSuccess: () => {
                    setSaved(true);
                    setTimeout(() => setSaved(false), 1500);
                  },
                },
              )
            }
          >
            {edit.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Remove ${box.label || "this box"} on ${box.site}`}
          disabled={forget.isPending}
          onClick={() => forget.mutate(box.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove
        </Button>
      </div>
    </li>
  );
}
