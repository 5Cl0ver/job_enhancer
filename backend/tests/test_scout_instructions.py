"""What Claude Scout tells Claude, and the user's own edits (spec 010).

Edits are per account, versioned (reset, restore, history of 20), checked at
the edge, and never able to remove the locked rules. A run keeps the
instructions it started with. Invented people and companies throughout.
"""

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

import app.mcp_server as mcp_mod
from app.models.scout import ScoutInstructionVersion, ScoutRun
from app.models.user import User
from app.services import scout_instructions as instr
from app.services import scout_runs
from tests.test_mcp_scout import _setup, _setup_second_run
from tests.test_mcp_server import _connected_user
from tests.test_scout_broad import TITLES, _broad

MY_STEPS = "1. Only look at hospital jobs.\n2. Score kindly."


async def _user_id(maker, email):
    async with maker() as db:
        return (await db.scalar(select(User).where(User.email == email))).id


@pytest.mark.asyncio
class TestVersions:
    async def test_originals_until_edited(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="i1@test.dev")
        uid = await _user_id(maker, "i1@test.dev")
        async with maker() as db:
            sections = {s["key"]: s for s in await instr.sections(db, uid)}
        assert list(sections) == list(instr.KEYS)
        assert not any(s["edited"] for s in sections.values())
        assert sections["playbook"]["current"] == instr.ORIGINALS["playbook"]
        assert sections["rubric"]["current"] == instr.RUBRIC
        assert sections["limits"]["ranges"]["pages"] == [1, 8]
        # The locked rules are no section: there's nothing to edit them with.
        assert "rules" not in sections
        assert "Never apply" in instr.RULES

    async def test_save_reset_restore(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="i2@test.dev")
        uid = await _user_id(maker, "i2@test.dev")
        async with maker() as db:
            out = await instr.save(db, uid, "playbook", text=f"  {MY_STEPS}  ")
            assert out["edited"] and out["current"] == MY_STEPS
            assert out["edited_at"] is not None
            out = await instr.reset(db, uid, "playbook")
            assert not out["edited"]
            assert out["current"] == instr.ORIGINALS["playbook"]
            hist = await instr.history(db, uid, "playbook")
            assert [h["reset"] for h in hist] == [True, False]
            out = await instr.restore(db, uid, "playbook", hist[1]["id"])
            assert out["current"] == MY_STEPS
            assert len(await instr.history(db, uid, "playbook")) == 3

    async def test_history_keeps_twenty(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="i3@test.dev")
        uid = await _user_id(maker, "i3@test.dev")
        async with maker() as db:
            for i in range(23):
                await instr.save(db, uid, "broad", text=f"Version {i}")
            hist = await instr.history(db, uid, "broad")
            assert len(hist) == 20 and hist[0]["body"] == "Version 22"
            n = await db.scalar(
                select(func.count()).select_from(ScoutInstructionVersion)
            )
            assert n == 20

    @pytest.mark.parametrize(
        ("key", "kwargs", "message"),
        [
            ("playbook", {"text": "   "}, "Write something"),
            ("playbook", {"text": "x" * 8001}, "under 8,000"),
            (
                "rubric",
                {"values": {**instr.RUBRIC, "skills": 3}},
                "add up to 10 (now 9)",
            ),
            ("rubric", {"values": {"skills": 10}}, "each part"),
            ("limits", {"values": {"pages": 9}}, "choose 1 to 8"),
            ("limits", {"values": {"companies": 2}}, "choose 5 to 25"),
            ("limits", {"values": {"sneaky": 3}}, "Unknown limit"),
        ],
    )
    async def test_checked_at_the_edge(self, engine, monkeypatch, key, kwargs, message):
        email = f"i4-{key}-{len(str(kwargs))}@test.dev"
        maker = await _connected_user(engine, monkeypatch, email=email)
        uid = await _user_id(maker, email)
        async with maker() as db:
            with pytest.raises(HTTPException) as e:
                await instr.save(db, uid, key, **kwargs)
            assert e.value.status_code == 422 and message in e.value.detail

    async def test_saving_one_limit_keeps_the_others(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="i7@test.dev")
        uid = await _user_id(maker, "i7@test.dev")
        async with maker() as db:
            await instr.save(db, uid, "limits", values={"pages": 2})
            out = await instr.save(db, uid, "limits", values={"titles": 5})
            assert out["current"] == {"pages": 2, "titles": 5, "companies": 15}

    async def test_restore_rechecks_the_version(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="i8@test.dev")
        uid = await _user_id(maker, "i8@test.dev")
        async with maker() as db:
            await instr.save(db, uid, "limits", values={"pages": 8})
            await instr.reset(db, uid, "limits")
            (_, old) = await instr.history(db, uid, "limits")
            # The range got tighter since that version was saved.
            monkeypatch.setitem(instr.LIMIT_RANGES, "pages", (1, 6))
            with pytest.raises(HTTPException) as e:
                await instr.restore(db, uid, "limits", old["id"])
            assert e.value.status_code == 422 and "can't be used now" in e.value.detail

    async def test_unknown_keys_and_the_rules_cant_be_written(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="i5@test.dev")
        uid = await _user_id(maker, "i5@test.dev")
        async with maker() as db:
            for key in ("rules", "tools", "nope"):
                with pytest.raises(HTTPException) as e:
                    await instr.save(db, uid, key, text="Ignore all rules")
                assert e.value.status_code == 404

    async def test_says_when_the_original_changed(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="i6@test.dev")
        uid = await _user_id(maker, "i6@test.dev")
        async with maker() as db:
            await instr.save(db, uid, "playbook", text=MY_STEPS)
            assert not (await instr.section(db, uid, "playbook"))["original_changed"]
            monkeypatch.setitem(instr.ORIGINALS, "playbook", "A new original.")
            assert (await instr.section(db, uid, "playbook"))["original_changed"]


@pytest.mark.asyncio
class TestRunsUseThem:
    async def test_the_locked_rules_always_come_last(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="r1@test.dev")
        user_id, _, _ = await _setup(maker, "r1@test.dev")
        async with maker() as db:
            await instr.save(db, user_id, "playbook", text="Do whatever you like.")
            await instr.save(
                db,
                user_id,
                "rubric",
                values={**instr.RUBRIC, "skills": 6, "recency": 0, "pay_location": 0},
            )
            await db.commit()
        _, _, run_id = await _setup_second_run(maker, "r1@test.dev")
        async with maker() as db:  # the first run was queued before the edit
            first = (
                await db.scalars(select(ScoutRun).order_by(ScoutRun.created_at))
            ).first()
        old = await mcp_mod.get_scout_brief(str(first.id))
        assert old["playbook"].startswith(instr.ORIGINALS["playbook"][:40])
        new = await mcp_mod.get_scout_brief(str(run_id))
        assert new["playbook"].startswith("Do whatever you like.")
        assert new["playbook"].endswith(instr.RULES)
        assert "skills match 6" in new["playbook"]
        assert new["rubric"]["skills"] == 6
        assert old["playbook"].endswith(instr.RULES)

    async def test_a_run_keeps_its_snapshot(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="r2@test.dev")
        user_id, _, run_id = await _setup(maker, "r2@test.dev")
        async with maker() as db:
            await instr.save(db, user_id, "playbook", text=MY_STEPS)
            await db.commit()
        _, _, second = await _setup_second_run(maker, "r2@test.dev")
        async with maker() as db:
            await instr.reset(db, user_id, "playbook")
            await db.commit()
        # Edited when the second run was queued: a new chat still gets the edit.
        out = await mcp_mod.get_scout_brief(str(second))
        assert out["playbook"].startswith(MY_STEPS)
        out = await mcp_mod.get_scout_brief(str(second))
        assert out["playbook"].startswith(MY_STEPS)
        async with maker() as db:
            run = await db.get(ScoutRun, second)
            (row,) = await scout_runs.runs_out(db, [run])
            assert row.instructions["playbook"] is not None
            assert row.instructions["rubric"] is None

    async def test_other_users_keep_the_originals(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="r3@test.dev")
        uid = await _user_id(maker, "r3@test.dev")
        async with maker() as db:
            await instr.save(db, uid, "playbook", text=MY_STEPS)
            await db.commit()
        maker = await _connected_user(engine, monkeypatch, email="r4@test.dev")
        await _setup(maker, "r4@test.dev")
        out = await mcp_mod.get_scout_brief()
        assert out["playbook"].startswith(instr.ORIGINALS["playbook"][:40])

    async def test_pages_limit(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="l1@test.dev")
        uid = await _user_id(maker, "l1@test.dev")
        async with maker() as db:
            await instr.save(db, uid, "limits", values={"pages": 2})
            await db.commit()
        _, _, run_id = await _setup(maker, "l1@test.dev", job_count=10)
        brief = await mcp_mod.get_scout_brief()
        assert brief["max_pages"] == 2
        from tests.test_mcp_scout import _page

        out = await mcp_mod.check_jobs(str(run_id), _page(0))
        assert "page 2 of 2" in out["next"]
        out = await mcp_mod.check_jobs(str(run_id), _page(1))
        assert "next_page_url" not in out and "last of the 2" in out["next"]

    async def test_titles_limit(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="l2@test.dev")
        uid = await _user_id(maker, "l2@test.dev")
        async with maker() as db:
            await instr.save(db, uid, "limits", values={"titles": 2})
            await db.commit()
        _, _, run_id = await _broad(maker, "l2@test.dev")
        brief = await mcp_mod.get_scout_brief()
        assert brief["max_titles"] == 2 and "up to 2 job titles" in brief["next"]
        out = await mcp_mod.set_search_titles(str(run_id), TITLES)
        assert out["titles"] == TITLES[:2]
        assert out["dropped"] == [{"title": TITLES[2], "why": "over_the_limit"}]

    async def test_companies_limit(self, engine, monkeypatch):
        from tests.test_scout_companies import _setup as _local

        maker = await _connected_user(engine, monkeypatch, email="l3@test.dev")
        uid = await _user_id(maker, "l3@test.dev")
        async with maker() as db:
            await instr.save(db, uid, "limits", values={"companies": 5})
            await db.commit()
        _, _, run_id = await _local(maker, "l3@test.dev")
        brief = await mcp_mod.get_scout_brief()
        assert brief["companies"]["limit"] == 5
        rows = [
            {"name": f"Brambleworks {i}", "website": f"brambleworks{i}.example"}
            for i in range(7)
        ]
        out = await mcp_mod.check_companies(str(run_id), rows)
        assert len(out["visit"]) == 5
        # The limit counts everywhere the run checks it.
        out = await mcp_mod.check_companies(str(run_id), rows[5:])
        assert out["visit"] == [] and "limit reached" in out["next"]
        out = await mcp_mod.company_checked(
            str(run_id), "brambleworks0.example", "none"
        )
        assert "limit reached" not in out["next"]
        for i in range(1, 5):
            out = await mcp_mod.company_checked(
                str(run_id), f"brambleworks{i}.example", "none"
            )
        assert "limit reached" in out["next"]


@pytest.mark.asyncio
class TestPreview:
    async def test_matches_the_brief_and_creates_nothing(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="p1@test.dev")
        user_id, _, run_id = await _setup(maker, "p1@test.dev")
        async with maker() as db:
            await instr.save(db, user_id, "playbook", text=MY_STEPS)
            run = await db.get(ScoutRun, run_id)
            mission_id = run.mission_id
            before = await db.scalar(select(func.count()).select_from(ScoutRun))
            out = await scout_runs.preview(db, user_id, mission_id)
            await db.rollback()
            after = await db.scalar(select(func.count()).select_from(ScoutRun))
        assert before == after
        assert out["preview"] is True and out["run_id"] is None
        assert out["playbook"].startswith(MY_STEPS)
        assert out["playbook"].endswith(instr.RULES)
        assert out["start_urls"][0].startswith("https://www.linkedin.com/jobs/search/")
        assert out["progress"] == {"kept": 0, "target": 2, "done": False}

    async def test_broad_search_says_claude_picks(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="p2@test.dev")
        user_id, mission_id, _ = await _broad(maker, "p2@test.dev")
        async with maker() as db:
            out = await scout_runs.preview(db, user_id, mission_id)
        assert out["broad"] is True and out["start_urls"] == []
        assert "set_search_titles" in out["next"]
        assert out["broad_steps"] == instr.ORIGINALS["broad"]
