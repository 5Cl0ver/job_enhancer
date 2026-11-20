This is a GOOGLE JOBS search. The start URL is Google's own job search.
These steps replace playbook steps 2 and 3; the rest of the playbook holds.

a. If Google shows a "Date posted" filter, choose the one closest to the
   search's "posted within" days first. Otherwise leave the filters as they are.
b. Read the jobs in the list as rows ({"company", "title", "fits"}; Google
   gives no link of their own) and send them to check_jobs, up to 30 at a
   time. For more, scroll the list and send the next ones.
c. For each job it returns that fits: open it, then open its "Apply on" link,
   the company's own site first when there's one. Report_job from that page,
   while it's open. Never report a google.com link.
