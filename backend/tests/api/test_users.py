"""Integration tests for user account endpoints (profile, export, delete)."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


@pytest.mark.asyncio
async def test_health_endpoint(anon_client: AsyncClient):
    """Health endpoint is always accessible."""
    response = await anon_client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_get_profile_unauthenticated(anon_client: AsyncClient):
    response = await anon_client.get("/v1/users/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_profile(client: AsyncClient, test_user: User):
    response = await client.get("/v1/users/me")
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == test_user.email
    assert data["role"] == "user"
    assert data["follow_up_days"] == 7


@pytest.mark.asyncio
async def test_update_profile_follow_up_days(client: AsyncClient):
    response = await client.patch("/v1/users/me", json={"follow_up_days": 14})
    assert response.status_code == 200
    assert response.json()["follow_up_days"] == 14


@pytest.mark.asyncio
async def test_export_data(client: AsyncClient, test_user: User):
    response = await client.get("/v1/users/me/export")
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    data = response.json()
    assert data["user"]["email"] == test_user.email
    # Seeded defaults are included
    assert len(data["collections"]) == 1
    assert len(data["pipeline_stages"]) == 8


@pytest.mark.asyncio
async def test_delete_account_soft_deletes(
    client: AsyncClient, test_user: User, db_session: AsyncSession
):
    response = await client.delete("/v1/users/me")
    assert response.status_code == 204

    user = await db_session.scalar(select(User).where(User.id == test_user.id))
    assert user is not None
    assert user.deleted_at is not None  # purged permanently after grace period


# ---------------------------------------------------------------------------
# Application profile ("profile vault" — feeds ATS autofill)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_application_profile_empty_then_upsert(client: AsyncClient):
    # Never filled → empty defaults, not a 404 (the Settings form just renders blank).
    r = await client.get("/v1/users/me/application-profile")
    assert r.status_code == 200
    assert r.json()["first_name"] is None
    assert r.json()["authorized_to_work"] is None

    # Partial save.
    r = await client.put(
        "/v1/users/me/application-profile",
        json={
            "first_name": "Fabian",
            "phone": "555-0100",
            "linkedin_url": "https://linkedin.com/in/fabian",
            "authorized_to_work": True,
            "requires_sponsorship": False,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["first_name"] == "Fabian"
    assert body["authorized_to_work"] is True

    # A later partial save must NOT wipe earlier answers.
    r = await client.put(
        "/v1/users/me/application-profile", json={"city": "Los Angeles"}
    )
    body = r.json()
    assert body["city"] == "Los Angeles"
    assert body["first_name"] == "Fabian"  # still there
    assert body["requires_sponsorship"] is False  # still there


@pytest.mark.asyncio
async def test_application_profile_rejects_bad_url(client: AsyncClient):
    r = await client.put(
        "/v1/users/me/application-profile",
        json={"github_url": "javascript:alert(1)"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_custom_answers_learn_and_reuse(client: AsyncClient):
    """Learn-as-you-go: empty at first, then upsert-by-key (re-answering a
    question updates it, doesn't duplicate)."""
    r = await client.get("/v1/users/me/custom-answers")
    assert r.status_code == 200
    assert r.json() == []

    r = await client.put(
        "/v1/users/me/custom-answers",
        json={
            "answers": [
                {
                    "question_key": "years of react experience",
                    "question_text": "Years of React experience?",
                    "answer": "3",
                },
                {
                    "question_key": "how did you hear about us",
                    "question_text": "How did you hear about us?",
                    "answer": "LinkedIn",
                },
            ]
        },
    )
    assert r.status_code == 200
    assert len(r.json()) == 2

    # Re-answer one → updates in place (still 2 rows, new value).
    r = await client.put(
        "/v1/users/me/custom-answers",
        json={
            "answers": [
                {
                    "question_key": "years of react experience",
                    "question_text": "Years of React experience?",
                    "answer": "4",
                }
            ]
        },
    )
    rows = {a["question_key"]: a["answer"] for a in r.json()}
    assert len(rows) == 2
    assert rows["years of react experience"] == "4"
    assert rows["how did you hear about us"] == "LinkedIn"

    # Delete one (the user fixed a wrong one in Settings) → only the other remains.
    d = await client.delete(
        "/v1/users/me/custom-answers/how%20did%20you%20hear%20about%20us"
    )
    assert d.status_code == 204
    r = await client.get("/v1/users/me/custom-answers")
    keys = [a["question_key"] for a in r.json()]
    assert keys == ["years of react experience"]


@pytest.mark.asyncio
async def test_export_includes_application_profile(client: AsyncClient):
    await client.put("/v1/users/me/application-profile", json={"first_name": "Fabian"})
    data = (await client.get("/v1/users/me/export")).json()
    assert data["application_profile"]["first_name"] == "Fabian"


@pytest.mark.asyncio
async def test_fill_profile_from_resume(client: AsyncClient, test_user, db_session):
    """POST from-resume: fills only EMPTY fields, never overwrites answers."""
    import uuid as _uuid
    from unittest.mock import AsyncMock, patch

    from app.models.resume import Resume

    # No resume yet → 404 with a helpful message.
    r = await client.post("/v1/users/me/application-profile/from-resume")
    assert r.status_code == 404

    db_session.add(
        Resume(
            id=_uuid.uuid4(),
            user_id=test_user.id,
            filename="resume.pdf",
            mime_type="application/pdf",
            file_size_bytes=100,
            extracted_text="Fabian Example — Los Angeles. (555) 010-0199",
            is_active=True,
        )
    )
    await db_session.commit()

    # The user already answered phone — extraction must NOT overwrite it.
    await client.put("/v1/users/me/application-profile", json={"phone": "555-867-5309"})

    with patch(
        "app.api.v1.users.extract_profile",
        new=AsyncMock(
            return_value={
                "first_name": "Fabian",
                "city": "Los Angeles",
                "phone": "(555) 010-0199",
            }
        ),
    ):
        r = await client.post("/v1/users/me/application-profile/from-resume")

    assert r.status_code == 200
    body = r.json()
    assert sorted(body["filled"]) == ["city", "first_name"]  # phone NOT in filled
    assert body["profile"]["first_name"] == "Fabian"
    assert body["profile"]["phone"] == "555-867-5309"  # untouched


@pytest.mark.asyncio
async def test_application_profile_rejects_fake_phone(client: AsyncClient):
    r = await client.put(
        "/v1/users/me/application-profile", json={"phone": "not a number"}
    )
    assert r.status_code == 422
    ok = await client.put(
        "/v1/users/me/application-profile", json={"phone": "(555) 010-0199"}
    )
    assert ok.status_code == 200
