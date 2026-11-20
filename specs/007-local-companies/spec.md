# Feature Specification: Claude Scout searches local companies and Google Jobs

**Feature Branch**: `feat/scout-local-companies`
**Created**: 2026-11-20
**Status**: Built
**Input**: The user: "I need to be able to search local companies. I only see
ZipRecruiter, LinkedIn and Indeed in the options when using Scout… using Google
to search literal local companies and their listings, always different ones,
not searching any job boards, rather direct companies." Then: "I don't mind it
checking them again every once in a while… sometimes a new listing will come
up" ("do 1 week"), and "Google Jobs is a good one also as a 5th choice."

Builds on [003-job-scout](../003-job-scout/spec.md) and
[006-know-where-things-are](../006-know-where-things-are/spec.md). The phone
rule from 005 holds: everything here works on a phone as on a computer.

## User Scenarios & Testing

### User Story 1 — Local companies (Priority: P1)

A new choice, **Local companies**, beside LinkedIn, Indeed and ZipRecruiter.
Claude in Chrome uses plain Google search to find businesses near the user's
city (the searches come from the resume type plus kinds of employer: hospitals,
manufacturers, banks, school districts…, different ones each run), goes to each
company's own website, finds its careers page and checks its openings. No job
board is ever used.

**Acceptance Scenarios**:

1. **Given** a Local companies search, **When** it's saved without a city,
   **Then** it says a city or area is needed; "Remote only" isn't offered.
2. **Given** a run, **When** Claude sends the companies a Google search listed,
   **Then** the app says which to visit: never job boards, directories or review
   sites, never one checked in the last 7 days, never one the user skipped, and
   at most 15 companies a run.
3. **Given** companies checked 7 or more days ago, **When** a run starts,
   **Then** up to 3 of them are checked again, the ones that had openings first,
   and the rest of the run goes to companies never checked.
4. **Given** a job on a company's site, **When** Claude reports it, **Then** it
   is copied word for word by Job Catcher as on the boards, scored, and waits in
   the same review; a job-board link is turned down.
5. **Given** a finished run, **Then** it says "Checked 12 local companies: 9 new
   · 3 re-checked · 4 had openings."
6. **Given** History, **Then** a folded list shows every company checked, linked
   to its careers page, with **Check next run** and **Never check** (and **Check
   again** for a skipped one).

### User Story 2 — Google Jobs (Priority: P2)

A fifth choice, **Google Jobs**: Google's own job search near the user. Claude
opens each fitting job's "Apply on" link (the company's own site first) and
reports that page; a google.com link is never the posting.

## Requirements

- **FR-001**: Scout offers five places to look: LinkedIn, Indeed, ZipRecruiter,
  Google Jobs, Local companies.
- **FR-002**: The app remembers each local company checked per user (website
  domain, name, careers page, last checked, times checked, last result,
  never-check). Names and links only, never job text.
- **FR-003**: A company is due again 7 days after its last check; at most 3
  re-checks and 15 companies per run.
- **FR-004**: Job Catcher copies job pages on any site while a Scout run is
  open, filling company and description from the page when the site has no
  structured job data, and only on pages that look like a posting.
- **FR-005**: Two new connector tools: `check_companies` and `company_checked`;
  the brief carries the source's own steps and the companies to re-check.

## Out of scope

Searching Google Maps directly, company lists typed in by the user, and the
LinkedIn repeat-results fix (its own change).
