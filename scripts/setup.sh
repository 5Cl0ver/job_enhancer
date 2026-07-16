#!/usr/bin/env bash
# Job Enhancer — one-time local setup.
# Run from the repository root:  bash scripts/setup.sh

set -e

echo "=== Job Enhancer Setup ==="

# ── Backend (FastAPI) ────────────────────────────────────────────────────────
echo ""
echo ">> Backend: creating venv + installing dependencies..."
cd backend
python3 -m venv .venv 2>/dev/null || python -m venv .venv
source .venv/bin/activate 2>/dev/null || source .venv/Scripts/activate
pip install -e ".[dev]"
deactivate
cd ..
echo "Backend ready."

# ── Frontend (Next.js) ───────────────────────────────────────────────────────
echo ""
echo ">> Frontend: installing dependencies..."
cd frontend && npm install && cd ..
echo "Frontend ready."

# ── Environment files ────────────────────────────────────────────────────────
echo ""
if [ ! -f backend/.env ]; then
    cp .env.example backend/.env
    echo "Created backend/.env — fill in your Supabase + job API keys."
else
    echo "backend/.env already exists, skipping."
fi
if [ ! -f frontend/.env.local ]; then
    cp frontend/.env.example frontend/.env.local
    echo "Created frontend/.env.local — fill in your Supabase project values."
else
    echo "frontend/.env.local already exists, skipping."
fi

echo ""
echo "=== Done. Next steps ==="
echo "1. Fill in backend/.env and frontend/.env.local (see README)"
echo "2. Seed sample data:   cd backend && .venv/bin/python scripts/seed_dev.py"
echo "3. Start the backend:  cd backend && .venv/bin/uvicorn app.main:app --reload"
echo "4. Start the frontend: cd frontend && npm run dev"
