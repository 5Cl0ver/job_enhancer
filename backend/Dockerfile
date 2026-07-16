FROM python:3.11-slim

# System dependencies for weasyprint (PDF generation)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Application code + dependencies
COPY pyproject.toml alembic.ini ./
COPY app/ ./app/
COPY alembic/ ./alembic/
RUN pip install --no-cache-dir .

# Non-root user for security
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000

# Render injects $PORT; apply migrations, then serve
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
