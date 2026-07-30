# Schemas Manifest (`backend/app/schemas/`)

Pydantic v2 request/response models — the API's typed **contract** (validation +
serialization). `model_config = {"from_attributes": True}` lets response schemas
read directly from ORM objects.

| File | Key schemas |
|---|---|
| `user.py` | `UserProfile`, `UserUpdate` |
| `job.py` | `JobListingSchema`, `PaginatedMeta`, `JobSearchResponse` |
| `collection.py` | `CollectionCreate`, `CollectionUpdate`, `CollectionSchema` |
| `saved_job.py` | `SavedJobCreate`, `SavedJobUpdate`, `SavedJobSchema` (nested `job_listing`) |
| `pipeline_stage.py` | `PipelineStageCreate`, `PipelineStageUpdate`, `PipelineStageSchema` |
| `saved_search.py` | `SavedSearchCreate`, `SavedSearchSchema`, new-matches feed shapes |
| `resume.py` | `ResumeSchema`, `GeneratedDocumentCreate/Update/Schema` |

**How this folder connects:** imported by `api/v1/*` routers as request bodies
and `response_model`s; populated from `models/*` ORM objects. The generated
OpenAPI (`specs/.../contracts/openapi.yml`) is derived from these + used to
generate the frontend's TS types.
