"""Spec 015: GET /v1/autofill/bundle — everything Job Catcher's autofill needs,
behind a cheap change check. Invented person only."""

import uuid

import pytest
from httpx import AsyncClient

from app.models.resume import Resume
from tests.api.test_scout_tracks import _other_user

PROFILE = {
    "first_name": "Wren",
    "last_name": "Calloway",
    "city": "Harborview",
    "authorized_to_work": True,
}


@pytest.mark.asyncio
class TestBundle:
    async def test_first_call_returns_everything(self, client: AsyncClient):
        await client.put("/v1/users/me/application-profile", json=PROFILE)
        await client.put(
            "/v1/users/me/custom-answers",
            json={
                "answers": [
                    {
                        "question_key": "how did you hear about us",
                        "question_text": "How did you hear about us?",
                        "answer": "LinkedIn",
                    }
                ]
            },
        )
        b = (await client.get("/v1/autofill/bundle")).json()
        assert b["changed"] is True and b["version"]
        assert b["email"] == "user@test.dev"
        assert b["profile"]["first_name"] == "Wren"
        assert b["profile"]["authorized_to_work"] is True
        assert b["answers"] == [
            {
                "question_key": "how did you hear about us",
                "question_text": "How did you hear about us?",
                "answer": "LinkedIn",
            }
        ]
        assert b["resume"] is None
        assert b["history"] is None

    async def test_unchanged_answers_with_version_only(self, client: AsyncClient):
        v = (await client.get("/v1/autofill/bundle")).json()["version"]
        again = (await client.get(f"/v1/autofill/bundle?version={v}")).json()
        assert again == {"changed": False, "version": v}

    async def test_any_change_changes_the_version(
        self, client: AsyncClient, db_session, test_user
    ):
        v1 = (await client.get("/v1/autofill/bundle")).json()["version"]
        await client.put("/v1/users/me/application-profile", json=PROFILE)
        v2 = (await client.get("/v1/autofill/bundle")).json()["version"]
        assert v2 != v1
        await client.put(
            "/v1/users/me/custom-answers",
            json={
                "answers": [
                    {
                        "question_key": "years of sql",
                        "question_text": "Years of SQL?",
                        "answer": "3",
                    }
                ]
            },
        )
        v3 = (await client.get("/v1/autofill/bundle")).json()["version"]
        assert v3 != v2
        db_session.add(
            Resume(
                id=uuid.uuid4(),
                user_id=test_user.id,
                filename="wren-calloway.pdf",
                mime_type="application/pdf",
                file_size_bytes=10,
                is_active=True,
            )
        )
        await db_session.flush()
        b = (await client.get(f"/v1/autofill/bundle?version={v3}")).json()
        assert b["changed"] is True
        assert b["resume"]["filename"] == "wren-calloway.pdf"

    async def test_only_my_data(self, client: AsyncClient, db_session):
        other = await _other_user(db_session)
        db_session.add(
            Resume(
                id=uuid.uuid4(),
                user_id=other.id,
                filename="theirs.pdf",
                mime_type="application/pdf",
                file_size_bytes=10,
                is_active=True,
            )
        )
        await db_session.flush()
        b = (await client.get("/v1/autofill/bundle")).json()
        assert b["resume"] is None
        assert b["answers"] == []

    async def test_needs_sign_in(self, anon_client: AsyncClient):
        assert (await anon_client.get("/v1/autofill/bundle")).status_code in (401, 403)
