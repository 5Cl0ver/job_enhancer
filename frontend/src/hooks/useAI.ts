/**
 * TanStack Query hooks for AI document generation and resume management.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { GeneratedDocument } from "@/types/api";

interface ResumeRecord {
  id: string;
  user_id: string;
  filename: string;
  mime_type: string;
  file_size_bytes: number;
  is_active: boolean;
  created_at: string;
}

export function useResumes() {
  return useQuery<ResumeRecord[]>({
    queryKey: ["resumes"],
    queryFn: () => api.get<ResumeRecord[]>("/v1/ai/resumes"),
    staleTime: 5 * 60_000,
  });
}

export function useUploadResume() {
  const qc = useQueryClient();
  return useMutation({
    // Route through the shared api client so the upload gets the Supabase Bearer
    // token (the endpoint requires auth) and the correct API base URL. The client
    // passes FormData through untouched and omits the JSON Content-Type so the
    // browser sets the multipart boundary itself.
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.post<ResumeRecord>("/v1/ai/resumes", form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resumes"] });
      // A new resume changes every job's match score.
      qc.invalidateQueries({ queryKey: ["match"] });
    },
  });
}

export function useGenerateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      resume_id: string;
      document_type: "resume" | "cover_letter";
      job_listing_id?: string;
    }) => api.post<GeneratedDocument>("/v1/ai/generate", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });
}

/**
 * Every document saved for a job — including résumés and cover letters Claude
 * wrote through the MCP connector (`save_draft`). Those land in the database
 * tagged with the job; this is how they reach the UI.
 */
export function useJobDocuments(jobListingId: string | null | undefined) {
  return useQuery<GeneratedDocument[]>({
    // Nested under ["documents"] on purpose: TanStack matches invalidations by
    // key prefix, so useGenerateDocument's invalidate reaches this list too.
    queryKey: ["documents", "by-job", jobListingId],
    queryFn: () =>
      api.get<GeneratedDocument[]>(
        `/v1/ai/documents?job_listing_id=${encodeURIComponent(jobListingId!)}`,
      ),
    enabled: !!jobListingId,
    staleTime: 30_000,
  });
}

export function useGeneratedDocument(docId: string | null) {
  return useQuery<GeneratedDocument>({
    queryKey: ["documents", docId],
    queryFn: () => api.get<GeneratedDocument>(`/v1/ai/documents/${docId}`),
    enabled: !!docId,
    staleTime: 60_000,
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, edited_content }: { id: string; edited_content: string }) =>
      api.patch<GeneratedDocument>(`/v1/ai/documents/${id}`, { edited_content }),
    onSuccess: (doc) => {
      qc.setQueryData(["documents", doc.id], doc);
      // Edited text is shown by the per-job list too, so refresh those.
      qc.invalidateQueries({ queryKey: ["documents", "by-job"] });
    },
  });
}
