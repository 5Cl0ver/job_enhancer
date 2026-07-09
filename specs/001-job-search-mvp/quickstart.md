# Quickstart Guide: Job Search Assistant MVP

**Branch**: `001-job-search-mvp` | **Date**: 2026-05-29

Test scenarios for verifying each user story independently.
These scenarios guide both manual QA and automated test cases.

---

## Prerequisites

Before running any scenario:

1. Backend running at `http://localhost:8000`
2. Frontend running at `http://localhost:3000`
3. Neon database connected and migrations applied (`alembic upgrade head`)
4. Environment variables set (see `.env.example`)
5. Test user account created (email: `test@example.com`)
6. Admin user account created (email: `admin@example.com`, role: `admin`)

---

## Story 1: Search and Discover Jobs (P1)

**Goal**: A user can find relevant job listings in under 3 seconds.

### Scenario 1a — Basic search returns results

1. Sign in as `test@example.com`
2. Navigate to `/search`
3. Enter `"Python Developer"` in the title field, `"New York"` in location
4. Click Search
5. **Expect**: Results appear within 3 seconds, at least one listing visible
6. **Expect**: Each result shows: title, company, location, salary (if available), source badge
7. **Expect**: No duplicate listings (same title + company + location from two sources)

### Scenario 1b — Filter by remote

1. Run the search above
2. Toggle the "Remote only" filter
3. **Expect**: Results update to show only remote-friendly listings
4. **Expect**: All returned listings have `is_remote: true`

### Scenario 1c — Filter by salary range

1. Run a search, set salary min = `$80,000`
2. **Expect**: No listings below `$80,000` min salary appear
3. **Expect**: Listings without salary data may still appear (null is not below threshold)

### Scenario 1d — Empty results state

1. Search for `"ZZZNonExistentJobXXX"` in `"Antarctica"`
2. **Expect**: Friendly empty state message, no errors
3. **Expect**: Suggestions to broaden search criteria shown

### Scenario 1e — AI unavailable (non-blocking)

1. Disable `NVIDIA_API_KEY` in backend env
2. Run a job search
3. **Expect**: Search works normally — AI features are not involved in job search

---

## Story 2: Save and Organize Jobs (P1)

**Goal**: A user can save jobs and organize them into collections.

### Scenario 2a — Save a job

1. Search for `"Frontend Developer"` and click on any result
2. Click the "Save" button
3. **Expect**: Job saved to default "Saved" collection
4. **Expect**: Save button changes to a "Saved" state indicator
5. **Expect**: Toast confirmation appears

### Scenario 2b — Create a collection and move a job

1. Navigate to `/saved`
2. Click "New Collection", name it `"Dream Jobs"`, choose a color
3. Select a saved job, choose "Move to Dream Jobs"
4. **Expect**: Job appears in "Dream Jobs" collection
5. **Expect**: Job count on "Dream Jobs" collection = 1

### Scenario 2c — Delete a collection

1. Delete the `"Dream Jobs"` collection
2. **Expect**: Collection is deleted
3. **Expect**: Jobs that were in it move to the default collection (not deleted)

### Scenario 2d — Persistence across sessions

1. Save 3 jobs, log out
2. Log back in as the same user
3. **Expect**: All 3 saved jobs still appear in `/saved`

---

## Story 3: Track Application Status (P2)

**Goal**: A user can track applications on a Kanban board with custom stages.

### Scenario 3a — Move job through pipeline

1. Open a saved job, click "Move to Applied", enter today's date as applied date
2. Navigate to `/tracker`
3. **Expect**: Job appears in the "Applied" column
4. **Expect**: Application date is displayed

### Scenario 3b — Full Kanban board visible

1. Save 5 jobs, move each to a different pipeline stage
2. Navigate to `/tracker`
3. **Expect**: All 8 default stage columns visible (Interested, Referral Sent, Applied, etc.)
4. **Expect**: Each job appears in its correct column

### Scenario 3c — Create a custom stage

1. On the tracker page, click "Add Stage", name it `"Coding Challenge"`
2. **Expect**: New column appears on the Kanban board
3. Move a saved job to "Coding Challenge"
4. **Expect**: Job appears in "Coding Challenge" column

### Scenario 3d — Follow-up reminder

1. Save a job, move it to "Applied" (set `applied_at` to 8+ days ago via API or DB)
2. Navigate to `/tracker`
3. **Expect**: That job shows a follow-up reminder indicator
4. **Expect**: Dashboard follow-up count increases by 1

### Scenario 3e — Default stages cannot be deleted

1. Attempt to delete the "Applied" stage via `DELETE /v1/pipeline-stages/{id}`
2. **Expect**: `400 Bad Request`, message: "Cannot delete default stage"

---

## Story 4: AI-Assisted Quick Apply (P2)

**Goal**: AI generates a tailored resume and cover letter within 15 seconds.

### Scenario 4a — Upload a resume

1. Navigate to `/ai-apply`
2. Upload a PDF resume file under 10MB
3. **Expect**: File accepted, parsed text visible in preview
4. **Expect**: Resume appears in resume list as active

### Scenario 4b — Generate a tailored resume

1. Open a saved job that has a full job description
2. Click "Optimize Resume" with the uploaded resume selected
3. **Expect**: AI response appears within 15 seconds
4. **Expect**: Generated resume references skills/keywords from the job description
5. **Expect**: `model_used` field set in the response (e.g., `meta/llama-3.3-70b-instruct`)

### Scenario 4c — Generate a cover letter

1. On the same saved job, click "Generate Cover Letter"
2. **Expect**: Cover letter appears within 15 seconds
3. **Expect**: Letter references the company name and role title from the job listing

### Scenario 4d — Edit and download

1. Edit the generated cover letter text in the editor panel
2. Click "Download PDF"
3. **Expect**: PDF file downloads with the edited content
4. **Expect**: `edited_content` field updated in `GeneratedDocument`

### Scenario 4e — AI service unavailable

1. Disable `NVIDIA_API_KEY` in backend env
2. Click "Generate Cover Letter"
3. **Expect**: Error message: "AI service unavailable. You can write your cover letter manually."
4. **Expect**: All other app features (search, save, tracker) continue to work

### Scenario 4f — Invalid file type rejected

1. Attempt to upload a `.txt` file as a resume
2. **Expect**: `400 Bad Request`, file type not accepted message

---

## Story 5: User Dashboard and Analytics (P3)

**Goal**: Dashboard accurately reflects application activity.

### Scenario 5a — Statistics summary

1. Have 5+ saved jobs in various pipeline stages
2. Navigate to `/analytics`
3. **Expect**: Total saved jobs count matches actual saved jobs
4. **Expect**: "Applied" count matches jobs in the Applied stage
5. **Expect**: "In Interview" count correct

### Scenario 5b — Activity trends (requires date data)

1. Ensure saved jobs have varying `created_at` dates (seed data or wait)
2. View the analytics trend chart
3. **Expect**: Chart renders without errors
4. **Expect**: Week-over-week activity visible if multiple weeks of data exist

---

## Story 6: Admin Dashboard (P3)

**Goal**: Admin can monitor platform health and user activity.

### Scenario 6a — Regular user cannot access admin

1. Sign in as `test@example.com` (regular user)
2. Navigate to `/admin` or call `GET /v1/admin/stats`
3. **Expect**: `403 Forbidden`, redirected away from admin page

### Scenario 6b — Admin sees user stats

1. Sign in as `admin@example.com`
2. Navigate to `/admin`
3. **Expect**: Total registered users count displayed
4. **Expect**: Active users (7d / 30d) displayed
5. **Expect**: Signup trend chart renders

### Scenario 6c — Service health panel

1. On the admin dashboard, view the health panel
2. **Expect**: Status indicators for: Database, NVIDIA API, Adzuna API, JSearch API
3. Disable `NVIDIA_API_KEY` and refresh
4. **Expect**: NVIDIA API status shows "degraded" or "down"

---

## Account Management

### Scenario A1 — Data export

1. Sign in as `test@example.com`
2. Call `GET /v1/users/me/export`
3. **Expect**: JSON file containing all saved jobs, collections, pipeline stages,
   generated document metadata
4. **Expect**: No raw passwords or secrets in the export

### Scenario A2 — Account deletion

1. Sign in as `test@example.com`, ensure data exists (saved jobs, etc.)
2. Call `DELETE /v1/users/me`
3. **Expect**: `204 No Content`
4. **Expect**: Subsequent login attempt fails (account gone)
5. **Expect**: Saved jobs owned by this user no longer exist in DB
6. **Expect**: Shared `JobListing` records still exist (other users unaffected)

---

## API Test Coverage Targets

| Router | Minimum scenarios to automate |
|--------|-------------------------------|
| `jobs.py` | search with filters, dedup verification |
| `saved_jobs.py` | save, update stage, delete, duplicate prevention |
| `collections.py` | CRUD, default collection protection |
| `pipeline_stages.py` | CRUD, default stage deletion blocked |
| `ai.py` | upload, generate (mocked NVIDIA), download PDF |
| `users.py` | profile, export, delete cascade |
| `admin.py` | stats, health, 403 for non-admin |
