"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: "user" | "admin";
  follow_up_days: number;
  created_at: string;
}

/** The signed-in user's profile from the backend (includes role). */
export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: () => api.get<UserProfile>("/v1/users/me"),
    staleTime: 5 * 60 * 1000,
  });
}
