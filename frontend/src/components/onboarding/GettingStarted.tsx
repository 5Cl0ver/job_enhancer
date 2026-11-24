import { Link, useNavigate } from "react-router-dom";
import { Check, ChevronRight, MoreHorizontal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useOnboarding,
  useUpdateOnboarding,
  type ChecklistKey,
} from "@/hooks/useOnboarding";
import { cn } from "@/lib/utils";

const ITEMS: Record<ChecklistKey, { label: string; to: string }> = {
  resume: { label: "Add your résumé", to: "/welcome?step=1" },
  profile: { label: "Check your profile", to: "/autofill#profile" },
  job_catcher: { label: "Get Job Catcher", to: "/job-catcher" },
  first_job: { label: "Save your first job", to: "/search" },
  email: { label: "Email updates", to: "/settings#email" },
  claude: { label: "Claude", to: "/settings#claude" },
};

/**
 * Getting started (spec 019 part B): what's done and what's next. Ticks come
 * from what the person really has, so they tick themselves. Hidden with "I'm
 * all set" (on every device) or once everything required is done; Settings
 * brings it back.
 */
export function GettingStarted() {
  const { data } = useOnboarding();
  const update = useUpdateOnboarding();
  const navigate = useNavigate();
  if (!data || data.checklist_hidden || data.required_done >= data.required_total) return null;

  const next = data.items.find((i) => i.required && !i.done)?.key;
  const pct = Math.round((data.required_done / data.required_total) * 100);

  return (
    <Card data-testid="getting-started">
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Getting started</h2>
            <p className="text-xs text-muted-foreground">
              {data.required_done} of {data.required_total} done
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Getting started options">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => update.mutate({ checklist_hidden: true })}>
                I'm all set
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate("/welcome")}>
                Open the welcome again
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Getting started progress"
          aria-valuemin={0}
          aria-valuemax={data.required_total}
          aria-valuenow={data.required_done}
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <ul className="flex flex-col">
          {data.items.map((item) => {
            const info = ITEMS[item.key];
            const isNext = item.key === next;
            return (
              <li key={item.key}>
                <Link
                  to={info.to}
                  aria-label={`${info.label}${item.done ? ", done" : ""}${item.required ? "" : ", optional"}`}
                  className={cn(
                    "flex min-h-10 items-center gap-3 rounded-md px-2 text-sm transition-colors hover:bg-accent pointer-coarse:min-h-12",
                    isNext && "bg-primary/10 font-medium",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                      item.done && "border-green-600 bg-green-600 text-white",
                    )}
                    aria-hidden
                  >
                    {item.done && <Check className="h-3 w-3" />}
                  </span>
                  <span className={cn("flex-1", item.done && "text-muted-foreground line-through")}>
                    {info.label}
                  </span>
                  {!item.required && <span className="text-xs text-muted-foreground">Optional</span>}
                  {!item.done && <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
