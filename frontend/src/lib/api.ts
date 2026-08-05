/**
 * Typed fetch wrapper for the Job Enhancer backend API.
 * Attaches the Supabase session access token as a Bearer header —
 * cookies are NOT forwarded cross-origin (Vercel → Render).
 */

import { createClient } from "@/lib/supabase/client";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let _supabase: ReturnType<typeof createClient> | null = null;

/** Current Supabase access token, or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  _supabase ??= createClient();
  const { data } = await _supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Attach the Bearer token and perform the fetch. Shared by JSON + blob helpers. */
async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();

  const headers: Record<string, string> = {
    ...(init.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" }),
    ...(init.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new ApiError(res.status, text);
  }

  return res;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(path, init);

  // 204 No Content — return null cast to T
  if (res.status === 204) return null as T;

  return res.json() as Promise<T>;
}

/**
 * Fetch a binary response (e.g. a generated PDF) WITH the auth header.
 * `window.open`/`<a download>` can't send a Bearer token, so protected file
 * downloads must go through here and be handed to the browser as a Blob.
 */
async function requestBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const res = await authedFetch(path, { ...init, method: "GET" });
  return res.blob();
}

export const api = {
  get: <T>(path: string, init?: RequestInit) =>
    request<T>(path, { ...init, method: "GET" }),

  post: <T>(path: string, body: unknown, init?: RequestInit) =>
    request<T>(path, {
      ...init,
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),

  patch: <T>(path: string, body: unknown, init?: RequestInit) =>
    request<T>(path, {
      ...init,
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  put: <T>(path: string, body: unknown, init?: RequestInit) =>
    request<T>(path, {
      ...init,
      method: "PUT",
      body: JSON.stringify(body),
    }),

  delete: <T = void>(path: string, init?: RequestInit) =>
    request<T>(path, { ...init, method: "DELETE" }),

  getBlob: (path: string, init?: RequestInit) => requestBlob(path, init),
};

export { ApiError, API_BASE };
