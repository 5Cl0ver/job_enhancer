# Frontend Components Manifest

React components for Job Enhancer (Next.js 15 + TypeScript + Tailwind + shadcn/ui).

## Directory Structure

```
src/components/
├── ui/           # shadcn/ui base components (button, card, badge, input, etc.)
├── layout/       # App shell
├── jobs/         # Job search and save UI
├── tracker/      # Kanban board
├── ai/           # AI document generation
├── analytics/    # User analytics charts
└── admin/        # Admin dashboard
```

## Layout Components (`layout/`)

| File | Purpose |
|------|---------|
| `Navbar.tsx` | Top bar — user avatar, sign-out button |
| `Sidebar.tsx` | Navigation links: Search, Saved, Tracker, AI Apply, Analytics, Settings |

## Job Components (`jobs/`)

| File | Purpose | Key Props |
|------|---------|-----------|
| `SearchBar.tsx` | Controlled query + location inputs, submits via URL params | `defaultQuery`, `defaultLocation` |
| `SearchFilters.tsx` | Remote toggle, job type select, salary min — all URL-param driven | — |
| `SearchResults.tsx` | Calls `useJobSearch`, renders grid of `JobCard`, handles pagination | `searchParams` |
| `JobCard.tsx` | Compact job listing card with save button stub | `job`, `onSave`, `isSaved` |
| `JobDetail.tsx` | Full job detail view with description, apply button, generate documents CTA | `job`, `onSave`, `onGenerateDocuments` |
| `SaveButton.tsx` | Toggle save/unsave with optimistic UI, icon or button variant | `jobId`, `variant` |
| `CollectionSidebar.tsx` | Collection list with create/delete, "All saved jobs" filter | `selectedId`, `onSelect` |

## Tracker Components (`tracker/`)

| File | Purpose |
|------|---------|
| `KanbanBoard.tsx` | DndContext wrapper, renders all pipeline columns, handles drag-end → `useMoveJobStage` |
| `PipelineColumn.tsx` | Single Kanban column — droppable zone, job cards, stage header + count |
| `KanbanCard.tsx` | Draggable job card — company, title, applied-ago, follow-up overdue badge (amber) |

## AI Components (`ai/`)

| File | Purpose |
|------|---------|
| `ResumeUpload.tsx` | Drag-drop + click upload, validates type (PDF/DOCX) + size (≤10MB), shows active resume |
| `GeneratedDocViewer.tsx` | Tabbed editor (Resume / Cover Letter) with inline editing + AI transparency footer (model + latency) |
| `DocumentControls.tsx` | Regenerate (with emphasis input) + Copy to clipboard + Download PDF buttons |

## Analytics Components (`analytics/`)

| File | Purpose |
|------|---------|
| `StatCard.tsx` | Icon + label + value card with optional trend arrow (up/down/neutral) |
| `ActivityChart.tsx` | Bar chart of applications per week using recharts |

## Admin Components (`admin/`)

| File | Purpose |
|------|---------|
| `HealthPanel.tsx` | Service status grid (Database, NVIDIA, Adzuna, JSearch) with latency + status badges |
| `StatsOverview.tsx` | 4-card grid: total users, active 7d/30d, new 7d |
| `UserTable.tsx` | Paginated user table (email, role, joined date) |
| `SignupTrendChart.tsx` | Line chart of daily signups (last 30 days) using recharts |

## Hooks (`src/hooks/`)

| File | Exported Hooks |
|------|---------------|
| `useJobs.ts` | `useJobSearch(params)`, `useJob(id)` |
| `useSavedJobs.ts` | `useCollections`, `useCreateCollection`, `useDeleteCollection`, `useSavedJobs`, `useSavedJobId`, `useSaveJob`, `useUpdateSavedJob`, `useUnsaveJob` |
| `useTracker.ts` | `usePipelineStages`, `useKanbanJobs`, `useMoveJobStage`, `useCreateStage`, `useDeleteStage` |
| `useAI.ts` | `useResumes`, `useUploadResume`, `useGenerateDocument`, `useGeneratedDocument`, `useUpdateDocument` |
| `useAnalytics.ts` | `useAnalyticsSummary` |
| `useAdmin.ts` | `useAdminStats`, `useServiceHealth`, `useAdminUsers` |
