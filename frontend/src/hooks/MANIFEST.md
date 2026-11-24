# Hooks Manifest (`frontend/src/hooks/`)

TanStack Query hooks — the **data layer**. Each wraps `lib/api.ts` calls to the
FastAPI `/v1` API and provides caching, loading/error state, and mutations with
optimistic updates where useful.

| File | Exported hooks | Backend endpoint(s) |
|---|---|---|
| `useJobs.ts` | `useJobSearch`, `useJob` | `GET /v1/jobs` |
| `useJobLinks.ts` | `useLinkOptions`, `useLinkJob`, `useUnlinkJob`, `useLinkEvent` | `/v1/saved-jobs/{id}/link*`, `/v1/email/events/{id}/link*` |
| `useSavedJobs.ts` | `useCollections`, `useCreateCollection`, `useDeleteCollection`, `useSavedJobs`, `useSavedJobId`, `useSaveJob`, `useJobSource` (where a job came from), `useRenameJob`, `useUpdateSavedJob`, `useUnsaveJob` | `/v1/collections`, `/v1/saved-jobs` |
| `useTracker.ts` | `usePipelineStages`, `useKanbanJobs`, `useMoveJobStage`, `useCreateStage`, `useDeleteStage` | `/v1/pipeline-stages` |
| `useSavedSearches.ts` | `useSavedSearches`, `useCreateSavedSearch`, `useDeleteSavedSearch`, `useNewMatches`, `useMarkMatchesSeen` | `/v1/saved-searches` |
| `useAnalytics.ts` | `useAnalyticsSummary` | `GET /v1/analytics/summary` |
| `useAdmin.ts` | `useAdminStats`, `useServiceHealth`, `useAdminUsers` | `/v1/admin/*` |
| `useAI.ts` | `useResumes`, `useUploadResume`, `useGenerateDocument`, `useJobDocuments`, `useGeneratedDocument`, `useUpdateDocument` | `/v1/ai/*` |
| `useProfile.ts` | `useProfile` | `GET /v1/users/me` |
| `useAttention.ts` | `useAttention` (counts for the nav badges; refreshed each minute and after any email action) | `GET /v1/attention` |
| `useIsPhone.ts` | `useIsPhone` (screen under 768px) — for places where phone and desktop are different components | — |
| `useJobsParams.ts` | `useJobsParams`: My Jobs' collection and "where from" kept in the address (`?folder=`, `?origin=`) so other pages can link to them | — |
| `useShowMore.ts` | `useShowMore` (draw a long list 30 at a time; loads the next page as its button scrolls into view) | — |
| `useJobCatcher.ts` | `useJobCatcherRelease`, `useJobCatcherConnections`, `useDisconnectJobCatcher`, `useConnectStatus`, `useApproveConnect`, `useCancelConnect` (spec 019) | `/v1/extension/*` |
| `useOnboarding.ts` | `useOnboarding(pollMs?)`, `useUpdateOnboarding` (spec 019 part B: Welcome progress and the Getting started ticks) | `/v1/onboarding` |
| `useResumeDetails.ts` | `useResumeDetails`, `useSaveResumeDetails`, `useReadResume`, `useSetJobResume` (spec 020: each résumé's jobs, schools, skills, read without AI; the résumé for one saved job) | `/v1/autofill/resumes/{id}/*`, `PUT /v1/saved-jobs/{id}/resume` |

**How this folder connects:** consumed by `routes/*` and `components/*`; every
request flows through `lib/api.ts` (which attaches the Supabase Bearer token).
The `QueryClientProvider` is set up in `src/providers.tsx`.
