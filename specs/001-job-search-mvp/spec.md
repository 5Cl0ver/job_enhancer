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
- **FR-005**: System MUST allow users to create, rename, and
  delete custom job collections
- **FR-006**: System MUST provide a Kanban-style board for
  tracking application pipeline stages
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

### Key Entities

- **User**: Represents a registered job seeker with profile
  information, authentication credentials, role (user or admin),
  and preferences
- **Job Listing**: A job opportunity with title, company,
  location, salary range, description, requirements, source URL,
  and freshness date
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
