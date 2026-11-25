# Quickstart: check Sites to skip

## Automated

| Part | Command |
|---|---|
| Backend | `cd backend && pytest -q tests/test_skipped_sites.py tests/test_mcp_scout.py tests/test_mcp_apply.py tests/test_migration_skipped_sites.py` |
| App | `cd frontend && npx vitest run tests/components/SkippedSites.test.tsx` |

## By hand (live, after merge)

1. **Add a site.**
   - In Claude Scout › Instructions › Sites to skip, paste `https://www.learn4good.com/jobs/online_remote/engineering/5663701391/e/`. The list shows `learn4good.com`.
   - Add `linkedin.com`. It warns first. Cancel.
2. **Run Scout.** Run Google Jobs · Anything I'd be good at. In the run log:
   - no find links to learn4good;
   - any learn4good rows count as "skipped sites".
3. **Remove it.** Press ✕ on learn4good.com. The next run can use it again.
4. **Never this site.** On a saved job from another reposting site, choose "Never this site" from ⋯. It appears in the list.
