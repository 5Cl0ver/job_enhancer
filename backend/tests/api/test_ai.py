"""Integration tests for AI endpoints: resume upload validation + mocked generation."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_upload_rejects_unsupported_type(client: AsyncClient):
    response = await client.post(
        "/v1/ai/resumes",
        files={"file": ("resume.txt", b"plain text", "text/plain")},
    )
    assert response.status_code == 400
    assert "Unsupported file type" in response.json()["detail"]


@pytest.mark.asyncio
async def test_upload_rejects_oversized_file(client: AsyncClient):
    big = b"x" * (10 * 1024 * 1024 + 1)
    response = await client.post(
        "/v1/ai/resumes",
        files={"file": ("resume.pdf", big, "application/pdf")},
    )
    assert response.status_code == 400
    assert "10 MB" in response.json()["detail"]


@pytest.mark.asyncio
async def test_upload_parse_and_list(client: AsyncClient):
    with patch(
        "app.api.v1.ai.resume_parser.parse_resume",
        new=AsyncMock(return_value="John Doe — Python, FastAPI, SQL"),
    ):
        response = await client.post(
            "/v1/ai/resumes",
            files={"file": ("resume.pdf", b"%PDF-1.4 fake", "application/pdf")},
        )
    assert response.status_code == 201
    resume = response.json()
    assert resume["filename"] == "resume.pdf"
    assert resume["is_active"] is True

    response = await client.get("/v1/ai/resumes")
    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_generate_document_mocked(client: AsyncClient):
    """Generation returns content + transparency metadata (mocked NVIDIA)."""
    with patch(
        "app.api.v1.ai.resume_parser.parse_resume",
        new=AsyncMock(return_value="Base resume text"),
    ):
        resume = (
            await client.post(
                "/v1/ai/resumes",
                files={"file": ("resume.pdf", b"%PDF-1.4 fake", "application/pdf")},
            )
        ).json()

    with patch(
        "app.api.v1.ai.ai_service.generate_cover_letter",
        new=AsyncMock(
            return_value=("Dear Hiring Manager...", "meta/llama-3.3-70b-instruct", 1234)
        ),
    ):
        response = await client.post(
            "/v1/ai/generate",
            json={"resume_id": resume["id"], "document_type": "cover_letter"},
        )

    assert response.status_code == 201
    doc = response.json()
    assert doc["content"].startswith("Dear Hiring Manager")
    assert doc["model_used"] == "meta/llama-3.3-70b-instruct"
    assert doc["generation_ms"] == 1234

    # Fetch + edit the document
    fetched = await client.get(f"/v1/ai/documents/{doc['id']}")
    assert fetched.status_code == 200

    edited = await client.patch(
        f"/v1/ai/documents/{doc['id']}", json={"edited_content": "My edit"}
    )
    assert edited.status_code == 200
    assert edited.json()["edited_content"] == "My edit"


@pytest.mark.asyncio
async def test_generate_requires_existing_resume(client: AsyncClient):
    import uuid

    response = await client.post(
        "/v1/ai/generate",
        json={"resume_id": str(uuid.uuid4()), "document_type": "resume"},
    )
    assert response.status_code == 404
