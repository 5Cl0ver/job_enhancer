"""Spec 017: taught boxes — POST/GET/DELETE /v1/autofill/taught, and their
place in the autofill bundle and the data export. Invented person only."""

import pytest
from httpx import AsyncClient

from app.models.taught_field import TaughtField
from tests.api.test_scout_tracks import _other_user

SITE = "www.paycomonline.net"
FP = {"label": "legal first name", "name": "legalFirstName", "kind": "text", "index": 0}


@pytest.mark.asyncio
class TestTaught:
    async def test_teach_list_forget(self, client: AsyncClient):
        r = await client.post(
            "/v1/autofill/taught",
            json={"site": SITE, "fingerprint": FP, "profile_key": "first_name"},
        )
        assert r.status_code == 201
        tid = r.json()["id"]
        listed = (await client.get("/v1/autofill/taught")).json()
        assert listed == [
            {
                "id": tid,
                "site": SITE,
                "label": "legal first name",
                "profile_key": "first_name",
                "answer_preview": None,
            }
        ]
        assert (await client.delete(f"/v1/autofill/taught/{tid}")).status_code == 204
        assert (await client.get("/v1/autofill/taught")).json() == []
        assert (await client.delete(f"/v1/autofill/taught/{tid}")).status_code == 404

    async def test_a_typed_answer_is_previewed_not_listed_whole(
        self, client: AsyncClient
    ):
        long = "Referred by a former colleague at the Harborview office " * 3
        await client.post(
            "/v1/autofill/taught",
            json={"site": SITE, "fingerprint": FP, "answer": long},
        )
        [row] = (await client.get("/v1/autofill/taught")).json()
        assert row["answer_preview"] == long[:40]

    async def test_teaching_the_same_box_again_replaces_it(self, client: AsyncClient):
        await client.post(
            "/v1/autofill/taught",
            json={"site": SITE, "fingerprint": FP, "profile_key": "first_name"},
        )
        await client.post(
            "/v1/autofill/taught",
            json={
                "site": SITE,
                "fingerprint": {**FP, "index": 2},
                "profile_key": "preferred_name",
            },
        )
        rows = (await client.get("/v1/autofill/taught")).json()
        assert [r["profile_key"] for r in rows] == ["preferred_name"]

    @pytest.mark.parametrize(
        "body",
        [
            {"site": SITE, "fingerprint": FP},  # no answer
            {
                "site": SITE,
                "fingerprint": FP,
                "profile_key": "email",
                "answer": "x",
            },  # both
            {
                "site": SITE,
                "fingerprint": FP,
                "profile_key": "Email; DROP",
            },  # not a key
            {
                "site": SITE,
                "fingerprint": {"label": "x" * 5000},
                "profile_key": "email",
            },  # too large
            {
                "site": SITE,
                "fingerprint": {"nested": {"a": 1}},
                "profile_key": "email",
            },  # not flat
            {"site": "", "fingerprint": FP, "profile_key": "email"},
        ],
    )
    async def test_bad_input_is_refused(self, client: AsyncClient, body):
        assert (await client.post("/v1/autofill/taught", json=body)).status_code == 422

    async def test_someone_elses_box_is_invisible_and_untouchable(
        self, client: AsyncClient, db_session
    ):
        other = await _other_user(db_session)
        theirs = TaughtField(
            user_id=other.id, site=SITE, fingerprint=FP, profile_key="email"
        )
        db_session.add(theirs)
        await db_session.commit()
        assert (await client.get("/v1/autofill/taught")).json() == []
        assert (
            await client.delete(f"/v1/autofill/taught/{theirs.id}")
        ).status_code == 404

    async def test_at_most_50_per_site_oldest_go_first(self, client: AsyncClient):
        for i in range(52):
            await client.post(
                "/v1/autofill/taught",
                json={
                    "site": SITE,
                    "fingerprint": {"label": f"q {i}", "kind": "text"},
                    "profile_key": "email",
                },
            )
        rows = (await client.get("/v1/autofill/taught")).json()
        assert len(rows) == 50
        assert "q 0" not in {r["label"] for r in rows} and "q 51" in {
            r["label"] for r in rows
        }

    async def test_in_the_bundle_and_it_changes_the_version(self, client: AsyncClient):
        v1 = (await client.get("/v1/autofill/bundle")).json()
        assert v1["taught"] == []
        await client.post(
            "/v1/autofill/taught",
            json={"site": SITE, "fingerprint": FP, "profile_key": "first_name"},
        )
        v2 = (await client.get(f"/v1/autofill/bundle?version={v1['version']}")).json()
        assert v2["changed"] is True
        assert v2["taught"][0] | {"id": None} == {
            "id": None,
            "site": SITE,
            "fingerprint": FP,
            "profile_key": "first_name",
            "answer": None,
        }

    async def test_in_the_data_export(self, client: AsyncClient):
        await client.post(
            "/v1/autofill/taught",
            json={"site": SITE, "fingerprint": FP, "profile_key": "first_name"},
        )
        export = (await client.get("/v1/users/me/export")).json()
        assert export["taught_fields"][0]["site"] == SITE


@pytest.mark.asyncio
async def test_two_boxes_under_one_heading_are_both_kept(client: AsyncClient):
    """Boxes the scanner couldn't label often share a heading: their names decide."""
    for name, key in (
        ("fname", "first_name"),
        ("lname", "last_name"),
        ("mail", "email"),
    ):
        await client.post(
            "/v1/autofill/taught",
            json={
                "site": SITE,
                "fingerprint": {
                    "label": "getting you started",
                    "name": name,
                    "kind": "text",
                },
                "profile_key": key,
            },
        )
    keys = sorted(
        r["profile_key"] for r in (await client.get("/v1/autofill/taught")).json()
    )
    assert keys == ["email", "first_name", "last_name"]
