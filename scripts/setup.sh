#!/usr/bin/env bash
# Job Enhancer — one-time project setup script
# Run from repository root: bash scripts/setup.sh

set -e

echo "=== Job Enhancer Setup ==="

# ── Backend ──────────────────────────────────────────────────────────────────
echo ""
echo ">> Setting up backend..."
cd backend
python -m venv .venv
source .venv/bin/activate || source .venv/Scripts/activate 2>/dev/null
pip install -e ".[dev]"
echo "Backend deps installed."
cd ..

# ── Frontend ─────────────────────────────────────────────────────────────────
echo ""
echo ">> Setting up frontend (Next.js 15)..."
# If frontend/ already exists and has package.json, just install
if [ -f frontend/package.json ]; then
    cd frontend && npm install && cd ..
else
    # First-time setup — run create-next-app
    echo "Creating Next.js app in frontend/ ..."
    npx create-next-app@latest frontend \
        --typescript \
        --tailwind \
        --eslint \
        --app \
        --src-dir \
        --import-alias "@/*" \
        --no-git
    cd frontend
    npm install \
        @tanstack/react-query \
        next-auth@beta \
        zod \
        @dnd-kit/core \
        @dnd-kit/sortable \
        recharts \
        openapi-typescript
    npx shadcn@latest init --defaults
    cd ..
fi
echo "Frontend deps installed."

# ── Environment ──────────────────────────────────────────────────────────────
echo ""
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env from .env.example — fill in your secrets before starting."
else
    echo ".env already exists, skipping."
fi

echo ""
echo "=== Setup complete! ==="
echo "Next steps:"
echo "  1. Edit .env with your API keys and database URL"
echo "  2. cd backend && alembic upgrade head"
echo "  3. cd backend && uvicorn app.main:app --reload"
echo "  4. cd frontend && npm run dev"
