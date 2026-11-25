# Tasks: Apply from the app

## Part A: server (PR `023-apply-from-the-app`)

- [X] T001 Migration t8c9d0e1f2a4: apply_runs.messages + claude_at; unescape job_listings title/company/location; migration test
- [X] T002 [US8] JobListing `@validates` unescape in backend/app/models/job_listing.py
- [X] T003 [US1] need_help choices + help reply (help-done {reply}) + reply in wait_for_you, in backend/app/services/apply_runs.py
- [X] T004 [US2] Messages: post (app), message_user (Claude), from_user on every tool, early return in wait_for_you
- [X] T005 [US3] Peek requests (app route + with need_help), same-kind replace, newest 5 kept
- [X] T006 [US4] 45 s waits; claude_at stamp; claude_stopped in the view
- [X] T007 [US5] confirmation_seen event; ask_if_sent; POST not-sent; sent while submitting
- [X] T008 [US6] job_catcher readiness in the view and brief
- [X] T009 [US7] Playbook/rules: message_user, choices, agreements and CAPTCHA, keep checking 30 min, any AI
- [X] T010 [P] Tests: tests/test_apply_from_app.py, tests/api/test_apply_api.py additions, tests/test_migration_apply_from_app.py

## Part B: app (PR `023-apply-from-the-app-ui`)

- [X] T020 [US2] Conversation + Message Claude box
- [X] T021 [US1] Help card: photo of the screen, quick answers, reply box, at-the-computer wording
- [X] T022 [US3] Show me the screen (latest photo + time)
- [X] T023 [US4] Claude stopped notice with the carry-on line
- [X] T024 [US5] Sent, confirmed / Did it go through?
- [X] T025 [US6] Job Catcher readiness line
- [X] T026 [US7][US8] Start card: any AI with the connector address; "(!)" tab title
- [X] T027 [P] Tests in frontend/tests/components/apply

## Part C: Job Catcher 0.41.0 (PR `023-apply-from-the-app-jc`)

- [ ] T030 [US3] Peek requests: one shot, the same tab checks
- [ ] T031 [US5] Confirmation watch after a Submit press; photo + confirmation_seen event
- [ ] T032 [US8] The panel never treats the app as an application; clean() decodes entities
- [ ] T033 [P] Unit + browser tests; version 0.41.0 + release notice
