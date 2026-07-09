"use client";

import { useRouter, useSearchParams } from "next/navigation";
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

const JOB_TYPES = [
  { value: "", label: "All types" },
  { value: "FULLTIME", label: "Full-time" },
  { value: "PARTTIME", label: "Part-time" },
  { value: "CONTRACT", label: "Contract" },
  { value: "INTERNSHIP", label: "Internship" },
];

const SALARY_OPTIONS = [
  { value: "", label: "Any salary" },
  { value: "30000", label: "$30k+" },
  { value: "50000", label: "$50k+" },
  { value: "80000", label: "$80k+" },
  { value: "100000", label: "$100k+" },
  { value: "150000", label: "$150k+" },
];

export function SearchFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const remoteOnly = searchParams.get("remote_only") === "true";
  const jobType = searchParams.get("job_type") ?? "";
  const salaryMin = searchParams.get("salary_min") ?? "";

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.set("page", "1");
      router.push(`/search?${params.toString()}`);
    },
    [router, searchParams],
  );

  const hasActiveFilters = remoteOnly || jobType || salaryMin;

  const clearFilters = () => {
    const params = new URLSearchParams();
    const q = searchParams.get("q");
    if (q) params.set("q", q);
    router.push(`/search?${params.toString()}`);
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
        onValueChange={(value) => updateParam("job_type", value || null)}
      >
        <SelectTrigger className="w-[140px]">
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
        onValueChange={(value) => updateParam("salary_min", value || null)}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Min salary" />
        </SelectTrigger>
        <SelectContent>
          {SALARY_OPTIONS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs">
          Clear filters
          <Badge variant="secondary" className="ml-1">
            {[remoteOnly, jobType, salaryMin].filter(Boolean).length}
          </Badge>
        </Button>
      )}
    </div>
  );
}
