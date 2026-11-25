"""Tests for the scan orchestration — emails → pending DetectedEvents."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models.detected_event import STATUS_PENDING, DetectedEvent
from app.models.email_account import EmailAccount
from app.models.job_listing import JobListing
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import SavedJob
from app.services.email_scan import EmailMessage, detect_events


async def _make_saved_job(db, user, company, title, stage_id=None):
    listing = JobListing(
        id=uuid.uuid4(),
        external_id=uuid.uuid4().hex,
        source="test",
        title=title,
        company=company,
        location="Remote",
        apply_url="https://example.com/apply",
        content_hash=uuid.uuid4().hex,
        company_normalized=company.lower(),
        title_normalized=title.lower(),
    )
    db.add(listing)
    await db.flush()
    sj = SavedJob(
        id=uuid.uuid4(),
        user_id=user.id,
        job_listing_id=listing.id,
        pipeline_stage_id=stage_id,
    )
    db.add(sj)
    await db.flush()
    return sj


async def _make_account(db, user):
    acct = EmailAccount(
        id=uuid.uuid4(),
        user_id=user.id,
        email_address="me@yahoo.com",
        provider="yahoo",
        imap_host="imap.mail.yahoo.com",
        imap_port=993,
        secret_encrypted="not-a-real-token",
    )
    db.add(acct)
    await db.flush()
    return acct


@pytest.mark.asyncio
class TestDetectEvents:
    async def test_rejection_creates_pending_event_with_undo_target(
        self, db_session, test_user
    ):
        stages = (
            await db_session.scalars(
                select(PipelineStage).where(PipelineStage.user_id == test_user.id)
            )
        ).all()
        applied_stage = next(s for s in stages if s.name == "Applied")
        job = await _make_saved_job(
            db_session,
            test_user,
            "Acme Corp",
            "Backend Engineer",
            stage_id=applied_stage.id,
        )
        acct = await _make_account(db_session, test_user)

        msgs = [
            EmailMessage(
                uid="101",
                from_addr="no-reply@acme.com",
                subject="Update on your application to Acme",
                body="Unfortunately we have decided to move forward with other "
                "candidates.",
                date=datetime(2026, 11, 18, 9, 14, tzinfo=UTC),
            )
        ]
        result = await detect_events(db_session, acct, msgs)

        assert len(result.created) == 1
        ev = result.created[0]
        assert ev.event_type == "rejected"
        assert ev.target_stage == "Rejected"
        # The email's own date is kept, so the page can say when it arrived.
        assert ev.email_date == datetime(2026, 11, 18, 9, 14, tzinfo=UTC)
        assert ev.saved_job_id == job.id
        assert ev.status == STATUS_PENDING
        # Undo target = where the card was before (Applied).
        assert ev.previous_stage_id == applied_stage.id

    async def test_unknown_email_is_ignored(self, db_session, test_user):
        await _make_saved_job(db_session, test_user, "Acme Corp", "Backend Engineer")
        acct = await _make_account(db_session, test_user)
        msgs = [
            EmailMessage(
                uid="1",
                from_addr="no-reply@indeed.com",
                subject="Jobs you may like",
                body="Here are 10 new roles near you.",
            )
        ]
        result = await detect_events(db_session, acct, msgs)
        assert result.created == [] and result.considered == []

    async def test_recruiter_contact_does_not_create_event(self, db_session, test_user):
        # A human recruiter email classifies as RECRUITER (no target stage). We
        # deliberately do NOT surface these — only card-moving updates — so no
        # event is created even though it matches a saved job.
        await _make_saved_job(db_session, test_user, "Acme Corp", "Backend Engineer")
        acct = await _make_account(db_session, test_user)
        msgs = [
            EmailMessage(
                uid="7",
                from_addr="jane.doe@acme.com",
                subject="Re: Backend role at Acme",
                body="Hi! I saw your resume and think you'd be a great fit for "
                "this position.",
            )
        ]
        result = await detect_events(db_session, acct, msgs)
        # Not surfaced (no card move) — but shown in the transparency list.
        # Kept as a recruiter message (never a card move).
        assert result.created == [] and result.considered == []
        (c,) = result.contacts
        assert (c.status, c.event_type, c.target_stage) == (
            "contact",
            "recruiter",
            None,
        )
        assert c.job_company == "Acme Corp"

    async def test_no_confident_job_match_is_skipped(self, db_session, test_user):
        await _make_saved_job(db_session, test_user, "Acme Corp", "Backend Engineer")
        acct = await _make_account(db_session, test_user)
        # A real rejection, but for a company the user never saved.
        msgs = [
            EmailMessage(
                uid="2",
                from_addr="no-reply@umbrella-corp.com",
                subject="Your application",
                body="Unfortunately we won't be moving forward.",
            )
        ]
        result = await detect_events(db_session, acct, msgs)
        # No card moved — but kept under "Not in your saved jobs".
        assert result.created == [] and result.review == []
        (u,) = result.unsaved
        assert (u.status, u.event_type, u.saved_job_id) == ("unsaved", "rejected", None)
        assert u.job_company.lower().startswith("umbrella")

    async def test_rescan_does_not_duplicate(self, db_session, test_user):
        await _make_saved_job(db_session, test_user, "Globex", "Frontend Developer")
        acct = await _make_account(db_session, test_user)
        msgs = [
            EmailMessage(
                uid="55",
                from_addr="talent@globex.com",
                subject="Interview with Globex — Frontend Developer",
                body="We'd like to schedule a call. What's your availability?",
            )
        ]
        first = await detect_events(db_session, acct, msgs)
        assert len(first.created) == 1
        # Same message again → no new event (deduped by UID).
        second = await detect_events(db_session, acct, msgs)
        assert second.created == []
        total = (
            await db_session.scalars(
                select(DetectedEvent).where(DetectedEvent.email_account_id == acct.id)
            )
        ).all()
        assert len(total) == 1


def _interview(uid, folder="INBOX", uv=1, **kw):
    return EmailMessage(
        uid=uid,
        from_addr="talent@globex.example",
        subject="Interview with Globex — Frontend Developer",
        body="We'd like to schedule a call. What's your availability?",
        folder=folder,
        uidvalidity=uv,
        **kw,
    )


async def _events(db, acct):
    return (
        await db.scalars(
            select(DetectedEvent).where(DetectedEvent.email_account_id == acct.id)
        )
    ).all()


@pytest.mark.asyncio
class TestDuplicates:
    async def _setup(self, db, user):
        await _make_saved_job(db, user, "Globex", "Frontend Developer")
        return await _make_account(db, user)

    async def test_event_records_folder_uidvalidity_and_key(
        self, db_session, test_user
    ):
        acct = await self._setup(db_session, test_user)
        await detect_events(db_session, acct, [_interview("5", email_id="E9")])
        (ev,) = await _events(db_session, acct)
        assert (ev.folder, ev.uidvalidity, ev.message_uid) == ("INBOX", 1, "5")
        assert ev.logical_key == "emailid:E9"

    async def test_move_between_inbox_and_spam_is_not_a_second_update(
        self, db_session, test_user
    ):
        acct = await self._setup(db_session, test_user)
        await detect_events(db_session, acct, [_interview("5", email_id="E9")])
        moved = _interview("812", folder="Bulk", uv=77, email_id="E9")
        assert (await detect_events(db_session, acct, [moved])).created == []
        assert len(await _events(db_session, acct)) == 1

    async def test_move_without_emailid_matches_message_id_and_content(
        self, db_session, test_user
    ):
        acct = await self._setup(db_session, test_user)
        await detect_events(db_session, acct, [_interview("5", message_id="<m1@x>")])
        moved = _interview("812", folder="Bulk", uv=77, message_id="<m1@x>")
        assert (await detect_events(db_session, acct, [moved])).created == []

    async def test_reused_message_id_does_not_suppress_a_different_email(
        self, db_session, test_user
    ):
        acct = await self._setup(db_session, test_user)
        await detect_events(db_session, acct, [_interview("5", message_id="<m1@x>")])
        forged = _interview("6", message_id="<m1@x>")
        forged.body = "Second round: please share your availability for Friday."
        assert len((await detect_events(db_session, acct, [forged])).created) == 1

    async def test_emails_without_ids_never_collapse(self, db_session, test_user):
        acct = await self._setup(db_session, test_user)
        result = await detect_events(
            db_session, acct, [_interview("5"), _interview("6", folder="Bulk", uv=77)]
        )
        assert len(result.created) == 2
        assert all(ev.logical_key is None for ev in result.created)

    async def test_legacy_row_is_adopted_not_repeated(self, db_session, test_user):
        acct = await self._setup(db_session, test_user)
        # A pre-migration row: inbox, no UIDVALIDITY, no logical key.
        await detect_events(db_session, acct, [_interview("5", uv=None)])
        (legacy,) = await _events(db_session, acct)
        assert legacy.uidvalidity is None
        again = await detect_events(db_session, acct, [_interview("5", uv=321)])
        assert again.created == []
        await db_session.refresh(legacy)
        assert legacy.uidvalidity == 321
        # Adopted: a later scan sees it by its full key.
        assert (
            await detect_events(db_session, acct, [_interview("5", uv=321)])
        ).created == []

    async def test_legacy_uid_with_different_subject_is_a_new_email(
        self, db_session, test_user
    ):
        acct = await self._setup(db_session, test_user)
        await detect_events(db_session, acct, [_interview("5", uv=None)])
        other = _interview("5", uv=321)
        other.subject = "Interview with Globex — second round"
        assert len((await detect_events(db_session, acct, [other])).created) == 1

    async def test_rescan_with_null_uidvalidity_does_not_repeat(
        self, db_session, test_user
    ):
        acct = await self._setup(db_session, test_user)
        await detect_events(db_session, acct, [_interview("5", uv=None)])
        assert (
            await detect_events(db_session, acct, [_interview("5", uv=None)])
        ).created == []


async def _stage_id(db, user, name):
    return await db.scalar(
        select(PipelineStage.id).where(
            PipelineStage.user_id == user.id, PipelineStage.name == name
        )
    )


def _globex(subject, body, uid="70"):
    return EmailMessage(
        uid=uid,
        from_addr="Priya Okafor <priya@globex.example>",
        subject=subject,
        body=body,
        folder="INBOX",
        uidvalidity=1,
    )


@pytest.mark.asyncio
class TestCardActions:
    async def _job_at(self, db, user, stage_name):
        sid = await _stage_id(db, user, stage_name) if stage_name else None
        await _make_saved_job(db, user, "Globex", "Frontend Developer", stage_id=sid)
        return await _make_account(db, user)

    async def test_classifies_on_newest_text_not_quoted_history(
        self, db_session, test_user
    ):
        acct = await self._job_at(db_session, test_user, "Applied")
        msg = _globex(
            "Re: Frontend Developer at Globex",
            "Great, see you Tuesday at 2pm for the interview.\n\n"
            "On Mon, Priya wrote:\n> We regret to inform you the role is closed.",
        )
        msg.newest_text = "Great, see you Tuesday at 2pm for the interview."
        result = await detect_events(db_session, acct, [msg])
        # The quoted rejection is history: it must not become a rejection.
        assert result.created == []
        kept = [*result.considered, *result.contacts, *result.hidden, *result.unsaved]
        assert kept and all(k.event_type != "rejected" for k in kept)

    async def test_reminder_never_proposes_a_move(self, db_session, test_user):
        acct = await self._job_at(db_session, test_user, "Applied")
        msg = _globex(
            "Reminder: your interview with Globex tomorrow",
            "This is a reminder of your interview for Frontend Developer tomorrow.",
        )
        result = await detect_events(db_session, acct, [msg])
        assert result.created == []
        # Never a move, but kept on the job (spec 027).
        (kept,) = result.noted
        assert (kept.status, kept.event_type) == ("noted", "interview")
        assert kept.saved_job_id is not None

    async def test_old_confirmation_does_not_move_card_backward(
        self, db_session, test_user
    ):
        acct = await self._job_at(db_session, test_user, "Interview")
        msg = _globex(
            "We received your application - Globex",
            "We have received your application for Frontend Developer.",
        )
        result = await detect_events(db_session, acct, [msg])
        assert result.created == []
        # The card stays, and the email stays on the job (spec 027).
        (kept,) = result.noted
        assert (kept.status, kept.event_type, kept.target_stage) == (
            "noted",
            "applied",
            "Applied",
        )

    async def test_unsure_is_shown_never_moved(self, db_session, test_user):
        acct = await self._job_at(db_session, test_user, "Applied")
        msg = _globex(
            "Globex Frontend Developer",
            "We regret to inform you the Frontend role is closed. We'd like to "
            "schedule an interview for another role instead.",
        )
        result = await detect_events(db_session, acct, [msg])
        assert result.created == [] and result.review == []  # never a question
        (item,) = result.hidden  # kept, but out of the way
        assert (item.event_type, item.status) == ("unsure", "hidden")
        assert item.target_stage is None

    async def test_offer_moves_forward_to_offer(self, db_session, test_user):
        acct = await self._job_at(db_session, test_user, "Interview")
        msg = _globex(
            "Offer - Frontend Developer at Globex",
            "We are delighted to offer you the Frontend Developer position.",
        )
        (ev,) = (await detect_events(db_session, acct, [msg])).created
        assert (ev.event_type, ev.target_stage) == ("offer", "Offer")
        assert ev.status == "pending"  # proposed, awaiting approval

    async def test_deleted_target_stage_is_still_proposed(self, db_session, test_user):
        acct = await self._job_at(db_session, test_user, "Applied")
        offer_stage = await db_session.get(
            PipelineStage, await _stage_id(db_session, test_user, "Offer")
        )
        await db_session.delete(offer_stage)
        await db_session.flush()
        msg = _globex(
            "Offer - Frontend Developer at Globex",
            "We are delighted to offer you the Frontend Developer position.",
        )
        (ev,) = (await detect_events(db_session, acct, [msg])).created
        assert ev.target_stage == "Offer"


@pytest.mark.asyncio
class TestMatchingInScan:
    async def _two_roles(self, db, user):
        applied = await _stage_id(db, user, "Applied")
        await _make_saved_job(
            db, user, "Quillfeather Labs", "Backend Engineer", stage_id=applied
        )
        await _make_saved_job(
            db, user, "Quillfeather Labs", "Frontend Engineer", stage_id=applied
        )
        return await _make_account(db, user)

    def _msg(
        self, uid, subject, body, sender="Priya Okafor <priya@quillfeather.example>"
    ):
        return EmailMessage(
            uid=uid,
            from_addr=sender,
            subject=subject,
            body=body,
            newest_text=body,
            folder="INBOX",
            uidvalidity=1,
        )

    async def test_unclear_job_goes_to_review_with_candidates(
        self, db_session, test_user
    ):
        acct = await self._two_roles(db_session, test_user)
        msg = self._msg(
            "1",
            "Quillfeather Labs — next steps",
            "We'd like to schedule an interview with you. What's your availability?",
            sender="Quillfeather Careers <careers@quillfeather.example>",
        )
        result = await detect_events(db_session, acct, [msg])
        assert result.created == []  # never guesses a role
        assert result.considered == []
        (item,) = result.review
        assert item.status == "needs_review" and item.saved_job_id is None
        assert (item.event_type, item.target_stage) == ("interview", "Interview")
        assert item.match_evidence == "several_roles"
        titles = {
            (await db_session.get(SavedJob, uuid.UUID(c))).job_listing_id
            for c in item.review_candidates
        }
        assert len(titles) == 2

    async def test_clear_match_reports_its_evidence(self, db_session, test_user):
        acct = await self._two_roles(db_session, test_user)
        msg = self._msg(
            "2",
            "Interview for Frontend Engineer",
            "We'd like to schedule an interview for the Frontend Engineer role.",
        )
        (ev,) = (await detect_events(db_session, acct, [msg])).created
        assert ev.match_evidence == "company_title" and ev.status == "pending"

    async def test_known_sender_is_learned_only_from_approved_updates(
        self, db_session, test_user
    ):
        acct = await self._two_roles(db_session, test_user)
        first = self._msg(
            "3",
            "Interview for Backend Engineer",
            "We'd like to schedule an interview for the Backend Engineer role.",
        )
        (ev,) = (await detect_events(db_session, acct, [first])).created
        later = "I'm sorry, I have to reschedule our interview. Are you free on Monday?"
        # Still pending: an unapproved guess teaches nothing.
        r = await detect_events(db_session, acct, [self._msg("4", "Re: hi", later)])
        assert r.created == [] and r.review[0].match_evidence == "several_roles"
        # Approved: the same person writing with no title now matches.
        ev.status = "applied"
        await db_session.flush()
        (ev2,) = (
            await detect_events(db_session, acct, [self._msg("5", "Re: hi", later)])
        ).created
        assert ev2.saved_job_id == ev.saved_job_id
        assert ev2.match_evidence == "known_sender"

    async def test_dismissed_update_teaches_nothing(self, db_session, test_user):
        acct = await self._two_roles(db_session, test_user)
        (ev,) = (
            await detect_events(
                db_session,
                acct,
                [
                    self._msg(
                        "6",
                        "Interview for Backend Engineer",
                        "We'd like to schedule an interview for the Backend Engineer role.",
                    )
                ],
            )
        ).created
        ev.status = "dismissed"
        await db_session.flush()
        r = await detect_events(
            db_session,
            acct,
            [self._msg("7", "Re: hi", "Can we reschedule our interview to Monday?")],
        )
        assert r.created == []

    async def test_review_items_are_stored_uncapped_and_not_repeated(
        self, db_session, test_user
    ):
        acct = await self._two_roles(db_session, test_user)
        msgs = [
            self._msg(
                str(100 + i),
                f"Quillfeather Labs — next steps ({i})",
                "We'd like to schedule an interview with you. What's your availability?",
                sender="Quillfeather Careers <careers@quillfeather.example>",
            )
            for i in range(45)
        ]
        r = await detect_events(db_session, acct, msgs)
        assert len(r.review) == 45  # no 40-item cap on items needing a choice
        # Rescanning the same mail (a cursor reset, a re-sync) adds nothing.
        again = await detect_events(db_session, acct, msgs)
        assert again.review == [] and again.created == []
        stored = list(
            await db_session.scalars(
                select(DetectedEvent).where(DetectedEvent.status == "needs_review")
            )
        )
        assert len(stored) == 45
        assert {s.match_evidence for s in stored} == {"several_roles"}
        assert all(len(s.review_candidates) == 2 for s in stored)

    async def test_matched_event_stores_its_evidence(self, db_session, test_user):
        acct = await self._two_roles(db_session, test_user)
        msg = self._msg(
            "8",
            "Interview for Frontend Engineer",
            "We'd like to schedule an interview for the Frontend Engineer role.",
        )
        (ev,) = (await detect_events(db_session, acct, [msg])).created
        db_session.expunge(ev)
        row = await db_session.get(DetectedEvent, ev.id)
        assert row.match_evidence == "company_title"

    async def test_saved_company_sender_makes_a_wordless_email_relevant(
        self, db_session, test_user
    ):
        applied = await _stage_id(db_session, test_user, "Applied")
        await _make_saved_job(
            db_session, test_user, "Vellacor", "Data Engineer", stage_id=applied
        )
        acct = await _make_account(db_session, test_user)
        msg = self._msg(
            "5",
            "Change of plans",
            "I'm so sorry, but I have to reschedule our call. Are you free on Monday afternoon instead?",
            sender="Rowan Ellery <rowan@vellacor.example>",
        )
        (ev,) = (await detect_events(db_session, acct, [msg])).created
        assert ev.event_type == "interview" and ev.match_evidence == "company_date"
