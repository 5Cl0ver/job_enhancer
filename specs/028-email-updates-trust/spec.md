# Feature Specification: Email updates you can trust

**Feature Branch**: `028-email-updates-trust`

**Created**: 2026-11-25

**Status**: Built (this PR). Not merged until the owner says go.

## The problem

Email Updates misread too many emails, and a few landed on the wrong job:

- **Wrong meaning.** Friendly rejections ("we'd love to keep your information on hand") read as unsure; receipts that describe possible next steps ("the process may include an interview") read as interviews; a rejection wrapped over two lines was missed; card offers, store coupons, sign-in codes, account-created mail and "how did we do?" surveys read as hiring news.
- **Wrong job.** An email that named only a company, or only a title, was treated as sure. A number-only company name matched every price in a coupon. One kind-of-business word ("Link", "Association") was taken as the company. Old emails from a company were put on a job saved there months later.
- **Missed job.** Company codes before a name ("C4410 Vellacor Group"), agency jobs ("Acme Dental (via Northgate Staffing)"), requisition numbers in a saved Workday link, and a hiring system that puts the recruiter's name where the company goes all kept a clear email from finding its job.

## What changed

**What an email means** (`email_classify.py`, `email_templates.py`):
- More ways of saying no count as a rejection; a "we hope you're open to future roles" line no longer hides one.
- Receipts stay receipts: "we will be scheduling interviews", "only candidates who match will be contacted" and lists of possible steps don't turn them into interviews or rejections. A real invite still counts.
- Card, loan and store offers, sign-in codes, account mail and surveys are not hiring updates.
- A recruiter's signature, or "you've been submitted to the client", marks recruiter mail.
- New hiring-site emails are read: Indeed "new interview times" and recruiter messages, LinkedIn "your application was viewed".

**Which job it's about** (`email_match.py`, `job_links.py`, `email_review.py`, `email_scan.py`):
- An email that names only the company, or only the title, still finds its job but **waits for a tap** instead of moving the card. A title-only match must be from the same site and close to when the job was saved.
- Placing leftover emails by company alone skips emails from more than 14 days before the job was saved, and never moves a card by itself; it moves only when the email also named the role.
- Company codes, "(via agency)" names, the company's own careers-site domain and requisition numbers in the saved link all count. A bare site link is not a job ID.
- A number-only name must appear whole ("The 45", not "$45"); a name made only of kind-of-business words must appear whole.
- An email naming another role at the same company is not put on this job.

## Before / after (65 hand-labelled emails from the owner's inbox)

Scored offline from cached mail; no scan, no database writes.

| | Right meaning | Right job | Put on a wrong job |
|---|---|---|---|
| Before | 43 / 65 (66%) | 43 / 65 (66%) | 6 |
| After | 63 / 65 (97%) | 62 / 65 (95%) | **0** |

The three still missed are left unplaced (safe), not misplaced.

## Not in this PR

- **Folding repeats**: several emails about the same update shown as one line.
- **The 30-day view** on Email updates.
- **Data cleanup**: updates already saved on the wrong job by earlier scans stay as they are until fixed by hand or by a later cleanup.
