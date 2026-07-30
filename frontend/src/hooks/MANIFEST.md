# Hooks Manifest (`frontend/src/hooks/`)

TanStack Query hooks — the **data layer**. Each wraps `lib/api.ts` calls to the
FastAPI `/v1` API and provides caching, loading/error state, and mutations with
optimistic updates where useful.

| File | Exported hooks | Backend endpoint(s) |
|---|---|---|
| `useJobs.ts` | `useJobSearch`, `useJob` | `GET /v1/jobs` |
| `useSavedJobs.ts` | `useCollections`, `useCreateCollection`, `useDeleteCollection`, `useSavedJobs`, `useSavedJobId`, `useSaveJob`, `useUpdateSavedJob`, `useUnsaveJob` | `/v1/collections`, `/v1/saved-jobs` |
| `useTracker.ts` | `usePipelineStages`, `useKanbanJobs`, `useMoveJobStage`, `useCreateStage`, `useDeleteStage` | `/v1/pipeline-stages` |
| `useSavedSearches.ts` | `useSavedSearches`, `useCreateSavedSearch`, `useDeleteSavedSearch`, `useNewMatches`, `useMarkMatchesSeen` | `/v1/saved-searches` |
| `useAnalytics.ts` | `useAnalyticsSummary` | `GET /v1/analytics/summary` |
| `useAdmin.ts` | `useAdminStats`, `useServiceHealth`, `useAdminUsers` | `/v1/admin/*` |
| `useAI.ts` | `useResumes`, `useUploadResume`, `useGenerateDocument`, `useGeneratedDocument`, `useUpdateDocument` | `/v1/ai/*` |
| `useProfile.ts` | `useProfile` | `GET /v1/users/me` |

**How this folder connects:** consumed by `routes/*` and `components/*`; every
request flows through `lib/api.ts` (which attaches the Supabase Bearer token).
The `QueryClientProvider` is set up in `src/providers.tsx`.
