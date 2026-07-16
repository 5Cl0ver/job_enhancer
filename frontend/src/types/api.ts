/** Auto-generated types from the backend OpenAPI schema.
 *  Source: specs/001-job-search-mvp/contracts/openapi.yml
 *  Regenerate: pnpm run generate-types
 */

export interface JobListing {
  id: string;
  external_id: string;
  source: string;
  title: string;
  company: string;
  location: string;
  is_remote: boolean;
  description: string | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  job_type: string | null;
  apply_url: string;
  posted_at: string | null;
  is_expired: boolean;
  created_at: string;
}

export interface PaginatedMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface JobSearchResponse {
  results: JobListing[];
  meta: PaginatedMeta;
}

export interface Collection {
  id: string;
  name: string;
  is_default: boolean;
  created_at: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  color: string | null;
  position: number;
  is_default: boolean;
}

export interface SavedJob {
  id: string;
  user_id: string;
  job_listing_id: string;
  collection_id: string | null;
  pipeline_stage_id: string | null;
  notes: string | null;
  applied_at: string | null;
  last_stage_change: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  job_listing: JobListing;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: string;
  follow_up_days: number;
  created_at: string;
}

export interface GeneratedDocument {
  id: string;
  document_type: "resume" | "cover_letter";
  content: string;
  edited_content: string | null;
  model_used: string | null;
  generation_ms: number | null;
  created_at: string;
}
