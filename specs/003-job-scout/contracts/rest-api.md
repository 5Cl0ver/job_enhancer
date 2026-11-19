# Contract: Scout REST API (for the Scout page)

Prefix `/v1/scout`, Bearer auth (Supabase JWT, same as every route). Pydantic
schemas in `backend/app/schemas/scout.py`; all lists are the caller's rows only.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | /tracks | | `TrackOut[]` |
| POST | /tracks | `TrackIn` | `TrackOut` 201; 409 name taken; 422 over 8 |
| PATCH | /tracks/{id} | partial `TrackIn` | `TrackOut` |
| DELETE | /tracks/{id} | | 204 (missions using it are deleted; jobs keep, track cleared) |
| GET | /missions | | `MissionOut[]` |
| POST | /missions | `MissionIn` | `MissionOut` 201 |
| PATCH / DELETE | /missions/{id} | | |
| POST | /missions/{id}/runs | | `RunOut` 201 with `prompt` (the text to paste) and `full_prompt` (fallback without the connector) |
| GET | /runs | `?limit=20` | `RunOut[]` newest first |
| GET | /runs/{id} | | `RunOut` + `findings: FindingOut[]` (polled while running) |
| POST | /runs/{id}/stop | | `RunOut` (status stopped) |
| POST | /findings/{id}/dismiss | | `FindingOut` (outcome dismissed; saved job archived if never moved) |
| GET | /companies | `?sort=last_checked|name&blocked=` | `CompanyOut[]` |
| PATCH | /companies/{id} | `{blocked?, careers_url?, ats?, employer_type?}` | `CompanyOut` |
| GET | /stats | | `{runs, saved, applied_from_scout, by_track:[…], by_source:[…]}` |

`RunOut.prompt` example:

```
Run my Job Scout mission "LinkedIn · IT Admin · 5 this week" (run 7f3c2a).
Use the Job Enhancer connector: start with get_scout_brief("7f3c2a…") and follow it.
```
