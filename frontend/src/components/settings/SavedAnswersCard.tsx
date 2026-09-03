import { useMemo, useState } from "react";
import {
  Brain,
  Briefcase,
  Check,
  DollarSign,
  GraduationCap,
  HelpCircle,
  Loader2,
  Megaphone,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useCustomAnswers,
  useDeleteCustomAnswer,
  useSaveCustomAnswer,
  type CustomAnswer,
} from "@/hooks/useCustomAnswers";

/** "3 days ago" style relative time. */
function relTime(iso?: string | null): string {
  if (!iso) return "";
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = secs / 60;
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.floor(hrs)}h ago`;
  const days = hrs / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ---- Categorization -------------------------------------------------------
// A light, client-side heuristic that buckets each learned question by topic so
// the library is scannable. First match wins; unmatched falls to "Other".
type CategoryId = "eligibility" | "experience" | "logistics" | "education" | "referral" | "other";

const CATEGORIES: {
  id: CategoryId;
  label: string;
  icon: typeof ShieldCheck;
  re?: RegExp;
}[] = [
  {
    id: "eligibility",
    label: "Work eligibility",
    icon: ShieldCheck,
    re: /authoriz|eligib|sponsor|visa|work permit|legally|citizen|right to work|clearance/i,
  },
  {
    id: "experience",
    label: "Experience & skills",
    icon: Briefcase,
    re: /experience|years|skill|proficien|familiar|expert|level of|rate your|programming|language|technolog|framework|tool/i,
  },
  {
    id: "logistics",
    label: "Salary & logistics",
    icon: DollarSign,
    re: /salary|compensation|\bpay\b|wage|\brate\b|relocat|notice|start date|available|remote|onsite|on-site|hybrid|commute|shift|travel|overtime|weekend/i,
  },
  {
    id: "education",
    label: "Education",
    icon: GraduationCap,
    re: /degree|education|\bgpa\b|universit|college|graduat|certif|diploma|major|school/i,
  },
  {
    id: "referral",
    label: "Referral & source",
    icon: Megaphone,
    re: /hear about|referr|\bsource\b|how did you (find|hear)|recruiter/i,
  },
  { id: "other", label: "Other", icon: HelpCircle },
];

const CAT_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<
  CategoryId,
  (typeof CATEGORIES)[number]
>;

function categorize(text: string): CategoryId {
  for (const c of CATEGORIES) if (c.re && c.re.test(text)) return c.id;
  return "other";
}

/**
 * "Answer Library" — the manager AND insights view for the extension's
 * learn-as-you-go memory. Every question you've ever answered, grouped by topic,
 * searchable, with usage stats ("used 4× · last used 3d ago"). Fix a wrong one
 * or delete anything junk; changes sync to the extension instantly.
 */
export function SavedAnswersCard() {
  const { data: answers = [], isLoading } = useCustomAnswers();
  const save = useSaveCustomAnswer();
  const del = useDeleteCustomAnswer();

  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "used" | "az">("recent");
  const [activeCat, setActiveCat] = useState<CategoryId | "all">("all");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);

  // Tag every answer with its category once.
  const tagged = useMemo(
    () => answers.map((a) => ({ ...a, cat: categorize(a.question_text) })),
    [answers],
  );

  // Insights over ALL answers (not affected by search/filter).
  const insights = useMemo(() => {
    const totalFills = tagged.reduce((n, a) => n + (a.use_count ?? 0), 0);
    const cats = new Set(tagged.map((a) => a.cat));
    const lastLearned = tagged.reduce<string | null>(
      (max, a) => (!max || (a.updated_at ?? "") > max ? a.updated_at ?? max : max),
      null,
    );
    return { total: tagged.length, totalFills, cats: cats.size, lastLearned };
  }, [tagged]);

  // Count per category (for the filter chips).
  const catCounts = useMemo(() => {
    const m = new Map<CategoryId, number>();
    for (const a of tagged) m.set(a.cat, (m.get(a.cat) ?? 0) + 1);
    return m;
  }, [tagged]);

  // Search + category filter + sort.
  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    let base = tagged.filter((a) => activeCat === "all" || a.cat === activeCat);
    if (needle) {
      base = base.filter(
        (a) =>
          a.question_text.toLowerCase().includes(needle) ||
          a.answer.toLowerCase().includes(needle),
      );
    }
    base = base.slice().sort((a, b) => {
      if (sort === "az") return a.question_text.localeCompare(b.question_text);
      if (sort === "used") return (b.use_count ?? 0) - (a.use_count ?? 0);
      return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
    });
    return base;
  }, [tagged, q, activeCat, sort]);

  // Group the filtered list by category, in the canonical category order.
  const groups = useMemo(() => {
    const byCat = new Map<CategoryId, typeof filtered>();
    for (const a of filtered) {
      if (!byCat.has(a.cat)) byCat.set(a.cat, []);
      byCat.get(a.cat)!.push(a);
    }
    return CATEGORIES.filter((c) => byCat.has(c.id)).map((c) => ({
      cat: c,
      items: byCat.get(c.id)!,
    }));
  }, [filtered]);

  const onSave = (a: CustomAnswer) => {
    const next = edits[a.question_key];
    if (next == null || next === a.answer) return;
    save.mutate(
      { ...a, answer: next },
      {
        onSuccess: () => {
          setEdits((e) => {
            const { [a.question_key]: _drop, ...rest } = e;
            return rest;
          });
          setSavedKey(a.question_key);
          setTimeout(() => setSavedKey(null), 1500);
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-4 w-4 text-primary" /> Answer Library
          {answers.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ({answers.length})
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Every question the extension has learned as you applied — grouped by topic,
          with how often each answer auto-fills. Fix a wrong one or delete anything
          junk; changes sync instantly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : answers.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            Nothing learned yet. When you apply and tap{" "}
            <span className="font-medium">“Remember my answers”</span> in the
            extension, your answers appear here.
          </p>
        ) : (
          <>
            {/* Insights strip */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Answers" value={insights.total} icon={Brain} />
              <Stat label="Auto-fills" value={insights.totalFills} icon={Sparkles} />
              <Stat label="Categories" value={insights.cats} icon={Briefcase} />
              <Stat
                label="Last learned"
                value={insights.lastLearned ? relTime(insights.lastLearned) : "—"}
                icon={Check}
              />
            </div>

            {/* Search + sort */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search questions or answers…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="h-9 rounded-md border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label="Sort answers"
              >
                <option value="recent">Recent</option>
                <option value="used">Most used</option>
                <option value="az">A–Z</option>
              </select>
            </div>

            {/* Category filter chips */}
            <div className="flex flex-wrap gap-1.5">
              <Chip active={activeCat === "all"} onClick={() => setActiveCat("all")}>
                All ({insights.total})
              </Chip>
              {CATEGORIES.filter((c) => catCounts.get(c.id)).map((c) => (
                <Chip
                  key={c.id}
                  active={activeCat === c.id}
                  onClick={() => setActiveCat(c.id)}
                >
                  <c.icon className="h-3.5 w-3.5" aria-hidden />
                  {c.label} ({catCounts.get(c.id)})
                </Chip>
              ))}
            </div>

            {/* Grouped answers */}
            {groups.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No answers match “{q}”.
              </p>
            ) : (
              <div className="space-y-4">
                {groups.map(({ cat, items }) => (
                  <div key={cat.id} className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <cat.icon className="h-3.5 w-3.5" aria-hidden />
                      {cat.label}
                      <span className="font-normal">({items.length})</span>
                    </div>
                    <ul className="space-y-2.5">
                      {items.map((a) => {
                        const value = edits[a.question_key] ?? a.answer;
                        const changed = value !== a.answer;
                        const justSaved = savedKey === a.question_key;
                        const uses = a.use_count ?? 0;
                        return (
                          <li
                            key={a.question_key}
                            className="rounded-lg border bg-card p-3"
                          >
                            <p className="mb-1.5 text-sm font-medium leading-snug">
                              {a.question_text}
                            </p>
                            <textarea
                              className="w-full min-h-[40px] resize-y rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                              rows={1}
                              value={value}
                              onChange={(e) =>
                                setEdits((prev) => ({
                                  ...prev,
                                  [a.question_key]: e.target.value,
                                }))
                              }
                            />
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                {justSaved ? (
                                  <span className="flex items-center gap-1 text-green-600">
                                    <Check className="h-3.5 w-3.5" /> Saved
                                  </span>
                                ) : changed ? (
                                  "Unsaved change"
                                ) : (
                                  <>
                                    <span
                                      className={cn(
                                        "inline-flex items-center gap-1",
                                        uses > 0 && "text-foreground/70",
                                      )}
                                    >
                                      <Sparkles className="h-3.5 w-3.5" />
                                      {uses > 0
                                        ? `used ${uses}×`
                                        : "not used yet"}
                                    </span>
                                    {a.last_used_at && (
                                      <span>· last {relTime(a.last_used_at)}</span>
                                    )}
                                  </>
                                )}
                              </span>
                              <div className="flex items-center gap-2">
                                {changed && (
                                  <Button
                                    size="sm"
                                    onClick={() => onSave(a)}
                                    disabled={save.isPending}
                                  >
                                    {save.isPending ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      "Save"
                                    )}
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => del.mutate(a.question_key)}
                                  disabled={del.isPending}
                                >
                                  <Trash2 className="mr-1 h-4 w-4" /> Delete
                                </Button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** A compact insight tile. */
function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof Brain;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold leading-tight">{value}</div>
    </div>
  );
}

/** A filter chip (category selector). */
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}
