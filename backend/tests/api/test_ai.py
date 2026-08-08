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


@pytest.mark.asyncio
async def test_resume_file_roundtrip(client: AsyncClient):
    """Upload stores the ORIGINAL bytes; /resumes/active/file returns them
    (the extension attaches this real file to ATS upload fields)."""
    from unittest.mock import AsyncMock, patch

    pdf_bytes = b"%PDF-1.4 fake resume bytes"
    with patch(
        "app.api.v1.ai.resume_parser.parse_resume",
        new=AsyncMock(return_value="parsed text"),
    ):
        up = await client.post(
            "/v1/ai/resumes",
            files={"file": ("resume.pdf", pdf_bytes, "application/pdf")},
        )
    assert up.status_code == 201

    r = await client.get("/v1/ai/resumes/active/file")
    assert r.status_code == 200
    assert r.content == pdf_bytes
    assert r.headers["content-type"].startswith("application/pdf")
    assert "resume.pdf" in r.headers["content-disposition"]


@pytest.mark.asyncio
async def test_resume_file_404_when_none(client: AsyncClient):
    r = await client.get("/v1/ai/resumes/active/file")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_document_pdf_download(client: AsyncClient, db_session, test_user):
    """The /pdf endpoint returns a real PDF (fpdf2, no native libs needed)."""
    import uuid as _uuid

    from app.models.generated_document import GeneratedDocument

    doc = GeneratedDocument(
        id=_uuid.uuid4(),
        user_id=test_user.id,
        document_type="cover_letter",
        content="Dear Hiring Manager,\n\nI'm excited — with smart quotes “like this”.",
    )
    db_session.add(doc)
    await db_session.commit()

    r = await client.get(f"/v1/ai/documents/{doc.id}/pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:4] == b"%PDF"  # a real PDF, and no 500 on the smart quotes
