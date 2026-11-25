# Feature Specification: Sites to skip

**Feature Branch**: `024-sites-to-skip`

**Created**: 2026-11-25

**Status**: Draft (research and plan only; nothing built)

**Input**: The owner, 2026-11-25:
> "Where in the app can I add links to websites to not go to? I hate these type of job boards, fucking annoying: https://www.learn4good.com/jobs/online_remote/engineering/5663701391/e/"
>
> "I want to have a section to add. I don't want it to break or use a lot of tokens."

**What exists today** (code and live data, read only):
- **No way to skip a website.** A résumé type's skip words (Claude Scout › Résumé types) match words in a job's title only.
- **Live data, Claude Scout's 151 finds:**
  - learn4good.com 13, jobleads.com 7, adzuna.com 3, remoterocketship.com 3, us.trabajo.org 2, recruit.net 1, talent.com 1.
  - About 1 in 6 finds are reposting sites like these, not the company's own posting.
  - Most come from Google Jobs' "Apply on …" links.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A list of sites to skip (Priority: P1)

**Where:** a **Sites to skip** section in **Claude Scout › Instructions**, also linked from Settings.

**Adding sites:**
- The user pastes any link from a site ("https://www.learn4good.com/jobs/…") or just its name ("learn4good.com"). The app keeps the site (learn4good.com), not the whole link.
- A site's sub-sites are covered too (uk.learn4good.com).

**Removing sites:**
- One tap on ✕.

**Suggestions:**
- Under the list, a few suggested sites seen in the user's own finds, each with "Skip it". This is **one tap each, never added on their own.**

**Acceptance Scenarios**:
1. **Given** the user pastes "https://www.learn4good.com/jobs/online_remote/engineering/5663701391/e/", **When** they add it, **Then** the list shows "learn4good.com".
2. **Given** "learn4good.com" is listed, **When** the user adds "learn4good.com" again, **Then** nothing changes ("Already on your list").
3. **Given** text that isn't a site ("hello"), **When** they add it, **Then** a plain message says so.
4. **Given** job boards the app relies on (linkedin.com, indeed.com, ziprecruiter.com, google.com), **When** the user adds one, **Then** it warns first ("Claude Scout searches LinkedIn: skipping it means…") and adds it only if they confirm.

### User Story 2 - Claude Scout never brings jobs from them (Priority: P1)

- **Checking results:** when Claude sends a results page, rows whose link goes to a skipped site are left out. The run log counts them ("2 skipped sites").
- **Reporting:** when Claude reports a job whose link is on a skipped site, the connector says no and tells it to use the company's own posting (or another "Apply on" option on Google Jobs).
- **The brief:** it lists the skipped sites in one short line, so Claude picks another "Apply on" link from the start.

**Acceptance Scenarios**:
1. **Given** learn4good.com is skipped, **When** Claude reports a learn4good link, **Then** the job isn't saved, and Claude is told to find the company's posting or another link.
2. **Given** a results page with a learn4good row, **When** Claude checks the rows, **Then** that row isn't one to open.

### User Story 3 - Apply with Claude never applies through them (Priority: P2)

When a job's apply link is on a skipped site, the apply brief says so. Claude finds the company's own posting and applies there, or asks the user with `need_help` if it can't find one.

### User Story 4 - One tap from a job (Priority: P3)

A job whose link is on a site has a **Never this site** action (on the job page, in its ⋯ menu). It adds the site to the list. The job itself stays (remove it the usual way).

### Edge Cases

- **Redirect links** (talent.com/redirect?…): the site is the link's own site (talent.com).
- **Jobs already saved** from a skipped site are left as they are. The list only stops new ones.
- **A company's own careers site** (careers.acme.com) is never suggested. Suggestions only come from a short built-in list of known reposting sites that also show up in the user's finds.

## Requirements *(mandatory)*

- **FR-001:** Each user has a list of up to 100 sites to skip, stored as plain hosts (lowercase, no "www."). Each can be added and removed in the app, on phone and computer.
- **FR-002:** A site matches its sub-sites (`host == site` or `host.endswith("." + site)`), never a look-alike (`evil-learn4good.com` doesn't match).
- **FR-003:** Claude Scout leaves out rows (check_jobs) and refuses reports (report_job) whose link is on a skipped site. Both cost nothing extra: they're checks on the server.
- **FR-004:** The Scout and Apply briefs include the list as one short line (sites only, at most 100). No other change to what Claude reads.
- **FR-005:** Warn before skipping a site Scout searches (LinkedIn, Indeed, ZipRecruiter, Google).
- **FR-006:** Suggestions are never added without a tap.
- **FR-007:** Nothing else changes: Scout's searches, results, near-misses and the Instructions page all look and work the same.

## Success Criteria *(mandatory)*

- **SC-001:** After the owner adds learn4good.com, no new Scout find links to it (checked in the live data a week later).
- **SC-002:** Claude's briefs grow by one line at most, and no new connector calls are needed.
- **SC-003:** All existing tests pass. New tests cover adding, matching, the Scout filters and the brief line.
