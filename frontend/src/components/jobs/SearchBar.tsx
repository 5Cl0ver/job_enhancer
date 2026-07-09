"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SearchBarProps {
  defaultQuery?: string;
  defaultLocation?: string;
}

export function SearchBar({ defaultQuery = "", defaultLocation = "" }: SearchBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(defaultQuery);
  const [location, setLocation] = useState(defaultLocation);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!query.trim()) return;

      const params = new URLSearchParams(searchParams.toString());
      params.set("q", query.trim());
      if (location.trim()) {
        params.set("location", location.trim());
      } else {
        params.delete("location");
      }
      params.set("page", "1");
      router.push(`/search?${params.toString()}`);
    },
    [query, location, router, searchParams],
  );

  return (
    <form onSubmit={handleSearch} className="flex w-full gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Job title, keywords..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          aria-label="Search query"
        />
      </div>
      <Input
        type="text"
        placeholder="Location (optional)"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        className="max-w-[200px]"
        aria-label="Location"
      />
      <Button type="submit" disabled={!query.trim()}>
        Search
      </Button>
    </form>
  );
}
