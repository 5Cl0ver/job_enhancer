"""Languages kept in the application profile (spec 020, US4).

Each language: its name, whether the user is fluent/native, and levels 1–5 for
comprehension, reading, speaking, writing and overall. Edited in the app; Job
Catcher fills Workday-style language blocks from it. Invented data only.
"""

import pytest
from httpx import AsyncClient

SPANISH = {
    "language": "Spanish",
    "native": False,
    "comprehension": 4,
    "reading": 4,
    "speaking": 4,
    "writing": 3,
    "overall": 4,
}


@pytest.mark.asyncio
async def test_languages_saved_and_returned(client: AsyncClient):
    r = await client.put(
        "/v1/users/me/application-profile",
        json={
            "languages": [
                {"language": "English", "native": True, "overall": 5},
                SPANISH,
            ]
        },
    )
    assert r.status_code == 200
    langs = r.json()["languages"]
    assert [x["language"] for x in langs] == ["English", "Spanish"]
    assert langs[0]["native"] is True and langs[0]["overall"] == 5
    assert langs[0]["reading"] is None  # unset levels stay unset
    assert langs[1]["writing"] == 3

    # A partial save of another field never wipes them.
    await client.put("/v1/users/me/application-profile", json={"city": "Salem"})
    r = await client.get("/v1/users/me/application-profile")
    assert len(r.json()["languages"]) == 2


@pytest.mark.asyncio
async def test_languages_validated(client: AsyncClient):
    bad_level = {**SPANISH, "reading": 6}
    r = await client.put(
        "/v1/users/me/application-profile", json={"languages": [bad_level]}
    )
    assert r.status_code == 422
    r = await client.put(
        "/v1/users/me/application-profile",
        json={"languages": [{"language": "", "overall": 3}]},
    )
    assert r.status_code == 422
    r = await client.put(
        "/v1/users/me/application-profile",
        json={"languages": [{"language": f"L{i}", "overall": 3} for i in range(11)]},
    )
    assert r.status_code == 422  # at most 10
    r = await client.put(
        "/v1/users/me/application-profile", json={"languages": [{"language": "x" * 61}]}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_languages_cleared_with_empty_list(client: AsyncClient):
    await client.put("/v1/users/me/application-profile", json={"languages": [SPANISH]})
    r = await client.put("/v1/users/me/application-profile", json={"languages": []})
    assert r.json()["languages"] == []


@pytest.mark.asyncio
async def test_languages_in_export_and_bundle(client: AsyncClient):
    await client.put("/v1/users/me/application-profile", json={"languages": [SPANISH]})
    export = (await client.get("/v1/users/me/export")).json()
    assert export["application_profile"]["languages"][0]["language"] == "Spanish"
    bundle = (await client.get("/v1/autofill/bundle")).json()
    assert bundle["profile"]["languages"][0]["speaking"] == 4
