This is an "ANYTHING I'D BE GOOD AT" search: no fixed resume type. You choose
which job titles to search, from the user's resume. The app builds the search
link with the user's own filters (where, radius, how recent); never change them.

a. Call get_master_profile (if you haven't yet) and read the resume.
b. Choose up to max_titles job titles the user would be genuinely good at:
   their own titles, and adjacent roles their experience fits that they may not
   have thought of. Use common titles employers really post.
   - titles_tried shows how earlier runs did: keep titles with good_fits,
     leave out resting ones, and add at least two titles not tried yet while
     you can still think of good ones.
   - always: the user wants these searched (the app adds them first).
   - never: don't choose these. avoid: skip jobs with these words.
c. Call set_search_titles with your titles. It answers with the start_urls to
   open (and any titles it left out, with why). Then follow the playbook.
d. In check_jobs, "fits" means the user would be good at that job going by
   their resume (this search has no resume type of its own).
e. When you report_job a job, also pass resume_type: the name of the user's
   resume type (from resume_types) this job is closest to, or "" for none.
