# Architecture Overview

## System Diagram

```
┌─────────────────────────┐     HTTPS      ┌─────────────────────────┐
│   Next.js 15 (Vercel)   │ ◄────────────► │  FastAPI (Railway)      │
│   TypeScript + Tailwind │                │  Python 3.11            │
│   NextAuth v5 (JWE JWT) │                │  SQLAlchemy 2.x (async) │
└─────────────────────────┘                └────────────┬────────────┘
         │                                              │
         │ OAuth (Google / GitHub)                      │ asyncpg
         │                                              ▼
         ▼                                   ┌─────────────────────┐
  ┌─────────────────┐                        │  PostgreSQL / Neon   │
  │  OAuth Provider │                        │  (serverless, free)  │
  └─────────────────┘                        └─────────────────────┘
                                                        │
                              ┌─────────────────────────┼───────────────┐
                              ▼                         ▼               ▼
                    ┌─────────────────┐   ┌──────────────────┐  ┌───────────┐
                    │  NVIDIA NIM     │   │  Adzuna API      │  │  JSearch  │
                    │  (LangChain)    │   │  (job listings)  │  │ (RapidAPI)│
                    └─────────────────┘   └──────────────────┘  └───────────┘
```

## Auth Flow (NextAuth JWE → FastAPI)

```
Browser → NextAuth (Next.js)
  1. User clicks "Sign in with Google/GitHub"
  2. OAuth callback → NextAuth creates encrypted JWE session token (AUTH_SECRET)
  3. JWE token stored as HttpOnly cookie (secure, SameSite=Lax)

Browser → FastAPI
  4. Every API request sends cookie automatically (credentials: "include")
  5. FastAPI: fastapi-nextauth-jwt decrypts JWE using HKDF(AUTH_SECRET)
  6. Extracts user email from jwt["email"] or jwt["sub"]
  7. Looks up User in DB — creates on first login (lazy creation)
  8. Returns CurrentUser to route handler
```

## AI Pipeline

```
User uploads resume (PDF/DOCX)
  ↓
FastAPI: pdfplumber / python-docx → extracted plain text
  ↓ stored in resumes.extracted_text
User selects "Generate" for a saved job
  ↓
ai_service.py: LangChain ChatNVIDIA
  ↓ System prompt + resume text + job description
  → NVIDIA NIM: meta/llama-3.3-70b-instruct (integrate.api.nvidia.com)
  ↓ Response + model_used + generation_ms
  ↓ stored in generated_documents
User edits inline → edited_content saved on blur
User clicks "Download PDF" → weasyprint renders HTML → PDF stream
```

## Job Deduplication Pipeline

```
Search request → aggregate_and_deduplicate()
  ↓
Parallel fetch: Adzuna API + JSearch API
  ↓
Parse + normalize: title, company, location
  ↓
Phase 1 (exact): content_hash = SHA-256(title_norm|company_norm|location_norm)
  → DB unique constraint prevents exact duplicates
  ↓
Phase 2 (fuzzy): rapidfuzz.token_sort_ratio
  → title ≥88 AND company ≥85 → skip as duplicate
  ↓
Insert new listings → DB query with filters → paginated response
```

## Deployment Topology

```
Vercel (Next.js)          Railway (FastAPI)         Neon (PostgreSQL)
─────────────────         ─────────────────         ─────────────────
Free tier (Hobby)         $5/month Starter          Free tier (0.5 GB)
Auto-deploy on push       Docker container          Serverless + PgBouncer
Edge CDN                  8000 port                 SSL required
NEXTAUTH_URL=production   DATABASE_URL=neon         prepared_statement_cache=0
```

## Scale Targets

- 50–100 concurrent users (free tier hosting)
- p95 search latency < 3s (target)
- p95 AI generation latency < 15s (target)
- NVIDIA NIM free tier: 40 RPM (enforced at API layer: 5 req/min per user)
