# Frontend Components Manifest (`frontend/src/components/`)

React components (Vite + TypeScript + Tailwind + shadcn/ui). The **pages** that
use them live in `src/routes/` (see its MANIFEST); the **data hooks** live in
`src/hooks/` (see its MANIFEST). Feature status: [docs/FEATURES.md](../../../docs/FEATURES.md).

```
ui/  base shadcn primitives   layout/  legacy shell bits
jobs/ tracker/ ai/ analytics/ admin/ settings/   feature UI
```

`theme-provider.tsx` — app theme context (light/dark/system) + `useTheme`; puts
the `dark` class on `<html>`. Initial class is set pre-paint by an inline script
in `index.html`; wired in `src/providers.tsx`.

## `ui/` — shadcn/ui primitives
alert, badge, button, card, dialog, dropdown-menu, input, label, select,
separator, skeleton, switch, table, tabs, textarea. Themed via CSS variables in
`src/globals.css`; use `cn()` from `lib/utils`.

## `scout/` — Claude Scout (Find Jobs → Claude Scout)

| File | Purpose |
|------|---------|
| `ScoutPanel.tsx` | The Claude Scout tab: views Start · History · Resume types (`?view=`) |
| `ScoutStart.tsx` | Saved searches (create/edit/delete), Start (queues a run), the open run: the one line to say to Claude in Chrome + live progress |
| `ScoutHistory.tsx` | Past runs; open one to see what it found |
| `RunFindings.tsx` | A run's jobs, best fit first: saved (links to the job), below bar, already had, not copied (open and press Save); Claude's reasons labelled as Claude's |
| `errorText.ts` | The server's `detail` message for a failed request |
| `ResumeTypes.tsx` | Resume types: five suggested types to start, cards, add/edit/delete dialog, resume upload that keeps the main resume |
| `JobResumeType.tsx` | Resume type picker on a saved job's page |

## `layout/`
| File | Purpose |
|---|---|
| `Navbar.tsx`, `Sidebar.tsx` | ⚠️ Legacy shell — the live app frame is `routes/DashboardLayout.tsx`; these are pending consolidation |
| `OfflineBanner.tsx` | Offline indicator when the browser goes offline |

## `jobs/`
| File | Purpose |
|---|---|
| `SearchBar.tsx` | Query + location inputs → URL params |
| `SearchFilters.tsx` | Remote/type/salary/experience filters → URL params |
| `SearchResults.tsx` | `useJobSearch` → grid of `JobCard` + pagination |
| `JobCard.tsx` | Job card: title, company, salary, source, apply/save |
| `JobDetail.tsx` | Full job view (legacy; no `/jobs/:id` route yet) |
| `SaveButton.tsx` | Optimistic save/unsave toggle |
| `SaveSearchButton.tsx` | Save current search criteria (FR-024) |
| `CollectionSidebar.tsx` | Collection list + create/delete + filter |
| `AddJobDialog.tsx` | Manually add a job by URL (`source=manual`) |
| `ApplyButton.tsx` | Opens external apply link + "Mark as Applied" confirm |

## `tracker/`
| File | Purpose |
|---|---|
| `KanbanBoard.tsx` | `DndContext`, renders columns, drag-end → `useMoveJobStage` |
| `PipelineColumn.tsx` | Droppable stage column + header/count |
| `KanbanCard.tsx` | Draggable job card + follow-up-overdue badge |

## `ai/` (final phase)
| File | Purpose |
|---|---|
| `ResumeUpload.tsx` | Drag-drop PDF/DOCX upload (≤10 MB) |
| `GeneratedDocViewer.tsx` | Tabbed resume/cover editor + AI-transparency footer |
| `DocumentControls.tsx` | Regenerate / copy / download-PDF |
| `JobDocuments.tsx` | Per-job résumés/cover letters (incl. Claude connector drafts): read, copy, PDF |

## `settings/`
| File | Purpose |
|---|---|
| `AppearanceCard.tsx` | Theme picker (Light / Dark / System) via `useTheme` |
| `ApplicationProfileCard.tsx` | Reusable autofill answers (name, links, etc.) |
| `SavedAnswersCard.tsx` | Answer Library & insights: learned answers grouped by topic, searchable, with usage stats; edit/delete |
| `EmailConnectCard.tsx` | Connect inbox for auto-status detection |

## `analytics/`
| `StatCard.tsx` | icon + value + trend arrow · | `ActivityChart.tsx` | recharts bar chart |

## `admin/`
| `HealthPanel.tsx` external-service status · `StatsOverview.tsx` user-count cards · `UserTable.tsx` paginated users · `SignupTrendChart.tsx` recharts line chart |

**How this folder connects:** components are composed by `routes/*`; they get
data via `hooks/*` → `lib/api.ts` → FastAPI.
