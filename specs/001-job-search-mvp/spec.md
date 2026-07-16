# Feature Specification: Job Search Assistant MVP

**Feature Branch**: `001-job-search-mvp`

**Created**: 2026-05-29

**Status**: Draft

**Input**: User description: "Full MVP job search assistant that helps find jobs, organize them, track applications, and use AI to quick-fill applications. This is a real hosted application for the developer and friends to use, and also serves as a portfolio showcase project for recruiters."

## Clarifications

### Session 2026-05-29

- Q: How should AI API keys be managed — user-provided (BYOK) or app-managed? → A: App-managed using free NVIDIA API keys. The app is hosted publicly for real users (developer + friends), not just a demo. AI costs absorbed via NVIDIA free tier.
- Q: Can users manage their own accounts (delete, export data)? → A: Full self-service. Users can delete their account and all associated data, plus a simple data export. Implementation should be straightforward but secure.
- Q: What is the target scale for concurrent users? → A: Small scale, ~50-100 concurrent users. Free tier hosting. Primarily the developer with a small group of friends.
- Q: Should pipeline stages be fixed or customizable? → A: Both. Keep the default stages (Interested, Applied, Phone Screen, Interview, Offer, Rejected) plus add "Referral Sent" and "Take-Home Assignment" as defaults. Users can also create their own custom stages.
- Q: How should duplicate job listings from multiple sources be handled? → A: Auto-deduplicate by matching on company name + job title + location. Keep the most complete listing. Can be refined iteratively as edge cases emerge.

### Session 2026-07-14

- Q: Can users add jobs they found elsewhere (LinkedIn, Indeed, company career pages) manually? → A: Yes — paste the job's URL and enter title, company, and optional location. The job is tagged as manually added and is saved/tracked identically to searched jobs. No automatic page-scraping in MVP.
- Q: Does the app ever fill or submit applications on external sites? → A: Combined — applying always happens on the external job site and the system NEVER auto-submits; additionally, a companion browser extension (final build phase, after AI features) auto-fills standard application form fields using the user's saved profile and generated materials, with the user reviewing and submitting manually.
- Q: After clicking an external apply link, should the app help update the tracker? → A: Yes — on return to the app, show a one-click "Did you apply? Mark as Applied" confirmation that records the date; never change status without user confirmation.

### Session 2026-07-16

- Q: How should jobs from external boards get into the app without manual pasting? → A: Adopt three patterns proven by leading tools: (1) the browser extension ships in two stages, and its v1 "job catcher" — one-click capture of the posting the user is viewing, details pre-filled from the page — is delivered right after the core product is live (no AI required); (2) saved searches re-run automatically on a schedule and surface a "New matches" feed in-app; (3) when the extension fills an application, that job is auto-saved/updated in the tracker and the "Mark as Applied" confirmation is triggered. Mass auto-apply bots remain permanently out of scope. Manual paste-a-link (FR-004a) stays as the fallback for one-offs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Search and Discover Jobs (Priority: P1)

As a job seeker, I want to search for jobs from multiple sources
so that I can find relevant opportunities without visiting
multiple job boards.

**Why this priority**: Job discovery is the core value proposition.
Without the ability to find jobs, no other feature matters.

**Independent Test**: Can be fully tested by entering a job title
and location, viewing results, and verifying relevant listings
appear from at least one source. Delivers immediate value as a
job aggregator.

**Acceptance Scenarios**:

1. **Given** the user is on the search page, **When** they enter
   a job title and location, **Then** relevant job listings appear
   within 3 seconds
2. **Given** search results are displayed, **When** the user
   applies filters (salary range, remote/hybrid/onsite, experience
   level), **Then** results update to match the selected criteria
3. **Given** search results are displayed, **When** the user
   clicks on a listing, **Then** they see the full job description
   with key details highlighted (salary, requirements, benefits)
4. **Given** the user saved a search (e.g., "Python Developer,
   New York, remote"), **When** they open the app the next day,
   **Then** a "New matches" feed shows jobs found since their
   last visit without re-running the search manually

---

### User Story 2 - Save and Organize Jobs (Priority: P1)

As a job seeker, I want to save interesting jobs and organize
them into custom collections so that I can manage my job search
effectively.

**Why this priority**: Saving and organizing is essential for
any multi-day job search. Without it, users lose track of jobs
they found.

**Independent Test**: Can be tested by saving a job, creating a
collection (e.g., "Dream Jobs", "Quick Apply"), moving jobs
between collections, and verifying persistence across sessions.

**Acceptance Scenarios**:

1. **Given** the user views a job listing, **When** they click
   "Save", **Then** the job is saved to their default collection
   and a confirmation appears
2. **Given** the user has saved jobs, **When** they create a new
   collection and drag a job into it, **Then** the job appears
   in the new collection
3. **Given** the user has multiple collections, **When** they
   view the organization page, **Then** they see all collections
   with job counts and can filter/sort within each
4. **Given** the user found a job on an external site (LinkedIn,
   Indeed, a company careers page), **When** they choose "Add job
   manually" and paste the URL plus title and company, **Then**
   the job is saved to their chosen collection and can be tracked
   like any other saved job

---

### User Story 3 - Track Application Status (Priority: P2)

As a job seeker, I want to track where each application stands
in the hiring pipeline so that I can follow up at the right
time and stay organized.

**Why this priority**: Application tracking turns a job list into
an actionable workflow. Important but depends on having saved
jobs first.

**Independent Test**: Can be tested by moving a saved job through
pipeline stages (Interested, Applied, Referral Sent, Phone Screen,
Take-Home Assignment, Interview, Offer, Rejected) and verifying
the dashboard reflects the changes. Can also add a custom stage
and verify it appears on the board.

**Acceptance Scenarios**:

1. **Given** a saved job, **When** the user marks it as "Applied"
   and enters the application date, **Then** the job moves to the
   "Applied" column on the tracker board
2. **Given** jobs in various pipeline stages, **When** the user
   views the tracker dashboard, **Then** they see a Kanban-style
   board with all stages and job counts
3. **Given** a job has been in "Applied" status for 7+ days,
   **When** the user views the dashboard, **Then** they see a
   follow-up reminder for that application
4. **Given** the user clicked a job's external apply link,
   **When** they return to the app, **Then** a one-click prompt
   asks "Did you apply?" and confirming moves the job to
   "Applied" with today's date

---

### User Story 4 - AI-Assisted Quick Apply (Priority: P2)

As a job seeker, I want AI to help me tailor my resume and
generate cover letters for specific jobs so that I can apply
faster with higher-quality materials.

**Why this priority**: AI-powered application assistance is the
key differentiator and most impressive portfolio feature. Depends
on having jobs to apply to.

**Independent Test**: Can be tested by selecting a saved job,
uploading a base resume, and verifying the AI produces a tailored
resume and cover letter that reference the specific job
requirements.

**Acceptance Scenarios**:

1. **Given** the user has uploaded a base resume and selected a
   saved job, **When** they click "Optimize Resume", **Then** the
   AI returns a tailored version highlighting relevant skills and
   experience within 15 seconds
2. **Given** the user has a saved job, **When** they click
   "Generate Cover Letter", **Then** the AI produces a
   professional cover letter referencing the company and role
   within 15 seconds
3. **Given** the AI has generated materials, **When** the user
   reviews them, **Then** they can edit, regenerate with
   different emphasis, or download as PDF

---

### User Story 5 - User Dashboard and Analytics (Priority: P3)

As a job seeker, I want to see an overview of my job search
progress so that I can understand my activity patterns and
improve my strategy.

**Why this priority**: Analytics enhance the experience but are
not required for core functionality. Serves as a polished
portfolio feature.

**Independent Test**: Can be tested by verifying the dashboard
displays accurate counts and charts after the user has saved
jobs and tracked applications.

**Acceptance Scenarios**:

1. **Given** the user has tracked multiple applications, **When**
   they view the dashboard, **Then** they see summary statistics
   (total applied, response rate, interviews scheduled)
2. **Given** the user has been active for multiple weeks, **When**
   they view the analytics section, **Then** they see activity
   trends over time (applications per week, response times)

---

### User Story 6 - Admin Dashboard (Priority: P3)

As the application owner, I want an admin dashboard so that I
can monitor application health, track user signups, and manage
the platform.

**Why this priority**: Essential for running a real hosted
application but not required for core user-facing functionality.
Demonstrates production-grade operational thinking.

**Independent Test**: Can be tested by logging in as admin and
verifying user counts, system health indicators, and management
actions work correctly.

**Acceptance Scenarios**:

1. **Given** the admin is authenticated, **When** they view the
   admin dashboard, **Then** they see total registered users,
   active users, and signup trends
2. **Given** the admin views the health panel, **When** external
   services (AI, job APIs) have issues, **Then** the dashboard
   shows service status indicators and error rates
3. **Given** the admin views the user list, **When** they select
   a user, **Then** they can see activity summary and account
   status

---

### User Story 7 - Browser Extension: Job Catcher & Auto-Fill (Priority: P4)

As a job seeker browsing external job sites, I want a companion
browser extension that saves any posting I'm viewing in one click
(v1) and fills application forms with my saved profile and
tailored materials (v2), so that collecting and applying to jobs
takes minutes instead of hours.

**Why this priority**: Highest-leverage speed feature. v1 capture
needs no AI and ships right after the core product is live; v2
auto-fill depends on the application profile and AI-generated
materials, so it ships last, after User Story 4.

**Independent Test (v1)**: With the extension installed, open a
job posting on a major job board and click "Save to tracker" —
the job's details are pre-filled from the page and appear in the
app's tracker.

**Independent Test (v2)**: With a tailored resume generated, open
a supported job application form and click "Fill" — standard
fields populate, and nothing is submitted until the user clicks
the site's own submit button.

**Acceptance Scenarios**:

1. **Given** the extension is installed and the user is viewing a
   job posting on an external board, **When** they click "Save to
   tracker", **Then** the posting's details are pre-filled from
   the page for review and saved to their tracker in one click
2. **Given** the extension is installed and the user is signed in,
   **When** they open an application form and click "Fill",
   **Then** standard fields (name, email, phone, links) populate
   from their profile and the tailored resume/cover letter text
   is available to insert
3. **Given** the extension filled an application form, **When**
   the user submits it on the site, **Then** the job is saved or
   updated in their tracker and the "Mark as Applied" confirmation
   is offered
4. **Given** a page the extension cannot recognize, **When** the
   user clicks "Save to tracker" or "Fill", **Then** the extension
   says so and offers the short manual form — the extension NEVER
   submits a form on its own

---

### Edge Cases

- What happens when no jobs match the search criteria?
  Display a friendly empty state with suggestions to broaden
  the search
- What happens when the AI service is unavailable?
  Show a clear message and allow manual resume/cover letter
  editing. All non-AI features continue to work normally
- What happens when a saved job posting is removed from the
  original source?
  Mark the job as "Listing Expired" but preserve all saved
  data and application tracking
- What happens when the user has no internet connection?
  Show cached data from the last session with an offline
  indicator. Searches and AI features display an appropriate
  message
- What happens when NVIDIA API rate limits are exceeded?
  Queue the request and notify the user with estimated wait
  time. Non-AI features continue to work normally

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to search for jobs by
  title, keywords, and location
- **FR-002**: System MUST display job results from at least one
  external job data source
- **FR-002a**: System MUST auto-deduplicate job listings from
  multiple sources by matching on company name, job title, and
  location, retaining the most complete listing
- **FR-003**: System MUST allow filtering results by salary
  range, job type (remote/hybrid/onsite), and experience level
- **FR-004**: System MUST allow users to save jobs to personal
  collections
- **FR-004a**: System MUST allow users to manually add an external
  job by pasting its URL and entering title, company, and optional
  location; manually added jobs are tagged with source "manual" and
  behave identically to searched jobs for saving, collections, and
  tracking
- **FR-005**: System MUST allow users to create, rename, and
  delete custom job collections
- **FR-006**: System MUST provide a Kanban-style board for
  tracking application pipeline stages
- **FR-006a**: When a user clicks a job's external apply link,
  the system MUST offer a one-click "Mark as Applied"
  confirmation on their return to the app, recording the
  application date; the system MUST NOT change application
  status without user confirmation
- **FR-007**: System MUST support these default pipeline stages:
  Interested, Applied, Referral Sent, Phone Screen, Take-Home
  Assignment, Interview, Offer, Rejected
- **FR-007a**: System MUST allow users to create, rename, reorder,
  and delete custom pipeline stages in addition to the defaults
- **FR-008**: System MUST allow users to upload a base resume
  (PDF or DOCX format)
- **FR-009**: System MUST generate AI-tailored resumes based on
  a specific job posting and the user's base resume
- **FR-010**: System MUST generate AI-written cover letters
  customized to specific job postings
- **FR-011**: System MUST allow users to edit, regenerate, and
  download AI-generated documents as PDF
- **FR-012**: System MUST display a user dashboard with
  application statistics and activity trends
- **FR-013**: System MUST support user authentication with
  secure sign-in (email/password and OAuth)
- **FR-014**: System MUST persist all user data across sessions
- **FR-015**: System MUST provide follow-up reminders when an
  application has had no status change for a configurable period
- **FR-016**: System MUST provide an admin-only dashboard showing
  registered user count, active users, and signup trends
- **FR-017**: System MUST display external service health status
  (AI provider, job APIs) on the admin dashboard
- **FR-018**: System MUST allow the admin to view user activity
  summaries and account status
- **FR-019**: System MUST distinguish between regular user and
  admin roles with appropriate access controls
- **FR-020**: System MUST allow users to permanently delete their
  account and all associated data (saved jobs, resumes, generated
  documents, collections)
- **FR-021**: System MUST allow users to export their data in a
  simple format (e.g., JSON or CSV)
- **FR-022**: System MUST provide a companion browser extension
  delivered in two stages: v1 "job catcher" (one-click capture,
  FR-022a) ships after the core product is live; v2 auto-fill
  (final build phase, after AI features) fills standard
  application form fields on external job sites using the user's
  saved profile and generated documents; the user always reviews
  and submits the form themselves
- **FR-022a**: The browser extension MUST provide one-click job
  capture: from a job posting the user is viewing (e.g., LinkedIn,
  Indeed, Glassdoor), it reads the visible posting, pre-fills the
  job's details for review, and saves the job to the user's
  tracker; unrecognized pages fall back to a short manual form
- **FR-022b**: When the extension fills an application form, the
  system MUST save or update that job in the user's tracker and
  trigger the one-click "Mark as Applied" confirmation (FR-006a)
- **FR-023**: System MUST let users maintain an application
  profile (name, email, phone, links such as LinkedIn/GitHub/
  portfolio) that the browser extension uses for form filling
- **FR-024**: System MUST support saved searches: a user can save
  search criteria, the system re-runs saved searches on a schedule
  (at least daily, within free data-source quotas), and newly
  found jobs appear in a "New matches" feed when the user next
  opens the app

### Out of Scope

- Automatic submission of applications on external sites — the
  user always clicks the final submit button themselves
- Automatic scraping/parsing of external job pages when adding a
  job manually (MVP is URL + manual fields; auto-extract may come
  later)
- Replacing job boards — the system aggregates, prepares, and
  tracks; applying happens at the source

### Key Entities

- **User**: Represents a registered job seeker with profile
  information, authentication credentials, role (user or admin),
  and preferences
- **Job Listing**: A job opportunity with title, company,
  location, salary range, description, requirements, source URL,
  and freshness date; source is either an aggregator feed or
  manual user entry
- **Collection**: A user-created group for organizing saved jobs
  (e.g., "Top Picks", "Quick Apply", "Dream Companies")
- **Saved Job**: A link between a user and a job listing, with
  notes, pipeline stage, application date, and follow-up status
- **Resume**: A user's uploaded base resume document, stored for
  AI processing
- **Generated Document**: An AI-produced tailored resume or cover
  letter tied to a specific saved job

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can find and save a relevant job within
  2 minutes of their first search
- **SC-002**: Users can move a job through all pipeline stages
  in under 30 seconds per transition
- **SC-003**: AI-generated resume and cover letter are produced
  within 15 seconds of request
- **SC-004**: Users rate AI-generated materials as "useful" or
  "very useful" at least 70% of the time
- **SC-005**: The application is usable and responsive on both
  desktop and mobile screen sizes
- **SC-006**: A new user can complete account creation and
  perform their first job search in under 3 minutes
- **SC-007**: The dashboard accurately reflects all tracked
  application data with zero discrepancies
- **SC-008**: All core features (search, save, track) remain
  functional when AI services are unavailable
- **SC-009**: Admin can identify system health issues within
  30 seconds of viewing the admin dashboard
- **SC-010**: System supports up to 100 concurrent users without
  performance degradation on free-tier hosting
- **SC-011**: With the browser extension, standard fields on a
  supported application form are filled in one click, and no form
  is ever submitted without an explicit user action

## Assumptions

- Users have a stable internet connection for search and AI
  features (offline mode is limited to cached data)
- Users already have a resume they can upload; the system does
  not create resumes from scratch
- Job data will be sourced from free-tier job APIs (Adzuna,
  JSearch via RapidAPI) rather than scraping job boards directly
- AI features use NVIDIA-hosted models via free API keys,
  managed by the application (users do not need their own keys)
- Mobile support means responsive web design, not a native
  mobile application
- The MVP targets English-language job markets
- User authentication will use standard OAuth 2.0 providers
  (Google, GitHub) plus email/password
- The application will be publicly hosted for real users
  (developer and friends), not just a demo
- Admin role is limited to the application owner; there is no
  self-service admin registration
- The browser extension targets Chromium-based browsers first and
  may be distributed unpacked (developer mode) to keep costs at
  zero; web store publication (small one-time fee) is optional
