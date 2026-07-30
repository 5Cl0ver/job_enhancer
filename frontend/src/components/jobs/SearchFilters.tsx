import { useNavigate, useSearchParams } from "react-router-dom";
import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

// Radix Select forbids empty-string item values — use sentinels.
const ANY = "any";

const JOB_TYPES = [
  { value: ANY, label: "All types" },
  { value: "FULLTIME", label: "Full-time" },
  { value: "PARTTIME", label: "Part-time" },
  { value: "CONTRACT", label: "Contract" },
  { value: "INTERNSHIP", label: "Internship" },
];

const SALARY_MIN_OPTIONS = [
  { value: ANY, label: "Any salary" },
  { value: "30000", label: "$30k+" },
  { value: "50000", label: "$50k+" },
  { value: "80000", label: "$80k+" },
  { value: "100000", label: "$100k+" },
  { value: "150000", label: "$150k+" },
];

const SALARY_MAX_OPTIONS = [
  { value: ANY, label: "No max" },
  { value: "60000", label: "Up to $60k" },
  { value: "100000", label: "Up to $100k" },
  { value: "150000", label: "Up to $150k" },
  { value: "200000", label: "Up to $200k" },
];

const EXPERIENCE_OPTIONS = [
  { value: ANY, label: "Any level" },
  { value: "entry", label: "Entry level" },
  { value: "mid", label: "Mid level" },
  { value: "senior", label: "Senior" },
];

export function SearchFilters() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const remoteOnly = searchParams.get("remote_only") === "true";
  const jobType = searchParams.get("job_type") ?? ANY;
  const salaryMin = searchParams.get("salary_min") ?? ANY;
  const salaryMax = searchParams.get("salary_max") ?? ANY;
  const experience = searchParams.get("experience") ?? ANY;

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== ANY) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.set("page", "1");
      navigate(`/search?${params.toString()}`);
    },
    [navigate, searchParams],
  );

  const activeCount = [
    remoteOnly,
    jobType !== ANY,
    salaryMin !== ANY,
    salaryMax !== ANY,
    experience !== ANY,
  ].filter(Boolean).length;

  const clearFilters = () => {
    const params = new URLSearchParams();
    const q = searchParams.get("q");
    const location = searchParams.get("location");
    if (q) params.set("q", q);
    if (location) params.set("location", location);
    navigate(`/search?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <Switch
          id="remote-only"
          checked={remoteOnly}
          onCheckedChange={(checked) =>
            updateParam("remote_only", checked ? "true" : null)
          }
        />
        <Label htmlFor="remote-only" className="cursor-pointer text-sm">
          Remote only
        </Label>
      </div>

      <Select
        value={jobType}
        onValueChange={(value) => updateParam("job_type", value)}
      >
        <SelectTrigger className="w-[140px]" aria-label="Job type">
          <SelectValue placeholder="Job type" />
        </SelectTrigger>
        <SelectContent>
          {JOB_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={salaryMin}
        onValueChange={(value) => updateParam("salary_min", value)}
      >
        <SelectTrigger className="w-[140px]" aria-label="Minimum salary">
          <SelectValue placeholder="Min salary" />
        </SelectTrigger>
        <SelectContent>
          {SALARY_MIN_OPTIONS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={salaryMax}
        onValueChange={(value) => updateParam("salary_max", value)}
      >
        <SelectTrigger className="w-[150px]" aria-label="Maximum salary">
          <SelectValue placeholder="Max salary" />
        </SelectTrigger>
        <SelectContent>
          {SALARY_MAX_OPTIONS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={experience}
        onValueChange={(value) => updateParam("experience", value)}
      >
        <SelectTrigger className="w-[140px]" aria-label="Experience level">
          <SelectValue placeholder="Experience" />
        </SelectTrigger>
        <SelectContent>
          {EXPERIENCE_OPTIONS.map((e) => (
            <SelectItem key={e.value} value={e.value}>
              {e.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {activeCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          className="h-8 text-xs"
        >
          Clear filters
          <Badge variant="secondary" className="ml-1">
            {activeCount}
          </Badge>
        </Button>
      )}
    </div>
  );
}
