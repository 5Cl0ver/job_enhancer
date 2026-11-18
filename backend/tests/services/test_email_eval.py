"""Tests for the offline email evaluation tooling (synthetic corpus + scorecard)."""

import csv
import email
from pathlib import Path

import pytest

from app.services.email_scan import EmailMessage
from evals.email_export import (
    EXPORT_COLUMNS,
    ExportRefused,
    ensure_git_ignored,
    jobs_path_for,
    write_label_export,
)
from evals.email_pipeline import (
    APPLIED,
    ERROR,
    EVENT_LABELS,
    INTERVIEW,
    REJECTED,
    UNKNOWN,
    excerpt,
    predict_raw,
)
from evals.email_scorecard import Scored, format_scorecard, score, wilson
from evals.email_synthetic import SAVED_JOBS, TEMPLATES, generate, split


class TestSyntheticCorpus:
    def test_same_seed_same_corpus(self):
        a, b = generate(n=200, seed=42), generate(n=200, seed=42)
        assert [e.raw for e in a] == [e.raw for e in b]
        assert generate(n=200, seed=43)[0].raw != a[0].raw

    def test_default_corpus_size_and_coverage(self):
        emails = generate()
        assert len(emails) == 1000
        assert {e.expected_event for e in emails} == set(EVENT_LABELS)
        assert {e.template_id for e in emails} == {t.id for t in TEMPLATES}
        assert len({e.id for e in emails}) == len(emails)

    def test_every_email_carries_its_ground_truth(self):
        keys = {j.key for j in SAVED_JOBS}
        for e in generate(n=len(TEMPLATES)):
            assert e.template_id and e.family
            assert e.expected_event in EVENT_LABELS
            assert e.expected_job is None or e.expected_job in keys

    def test_raw_mail_parses_and_uses_fictional_employers(self):
        for e in generate(n=len(TEMPLATES)):
            msg = email.message_from_bytes(e.raw)
            assert msg["Message-ID"].endswith("@synthetic.example>")
            assert "example.com" in msg["To"]
        assert all(j.domain.endswith(".example") for j in SAVED_JOBS)

    def test_split_keeps_families_whole(self):
        emails = generate()
        dev, holdout = split(emails)
        assert dev and holdout and len(dev) + len(holdout) == len(emails)
        assert not {e.family for e in dev} & {e.family for e in holdout}
        # Stratified: every label appears on both sides.
        assert {e.expected_event for e in dev} == set(EVENT_LABELS)
        assert {e.expected_event for e in holdout} == set(EVENT_LABELS)

    def test_split_puts_every_special_case_on_both_sides(self):
        emails = generate()
        dev, holdout = split(emails)
        fams_with: dict[str, set[str]] = {}
        for e in emails:
            for t in e.tags:
                fams_with.setdefault(t, set()).add(e.family)
        shared = {t for t, fams in fams_with.items() if len(fams) >= 2}
        for tag in ("charset", "html_only", "hidden", "quoted", "polarity"):
            assert tag in shared
        for part in (dev, holdout):
            assert shared <= {t for e in part for t in e.tags}

    def test_holdout_has_rejections_the_baseline_catches_and_misses(self):
        _, holdout = split(generate())
        rej_tags = {t for e in holdout if e.expected_event == REJECTED for t in e.tags}
        assert {"baseline_hit", "baseline_miss"} <= rej_tags

    def test_split_is_deterministic(self):
        emails = generate()
        assert [e.id for e in split(emails)[1]] == [e.id for e in split(emails)[1]]

    def test_reminders_are_interviews_with_no_card_change(self):
        reminders = [e for e in generate() if e.template_id == "int.reminder"]
        assert reminders
        assert all(e.expected_event == INTERVIEW for e in reminders)
        assert all(e.expected_action is None for e in reminders)
        invite = next(e for e in generate() if e.template_id == "int.invite")
        assert invite.expected_action == "Interview"

    def test_polarity_pairs_share_a_family(self):
        by_id = {t.id: t.family for t in TEMPLATES}
        assert by_id["int.move_forward.positive"] == by_id["rej.move_forward.others"]
        assert by_id["off.letter"] == by_id["rej.unable_to_offer"]


class TestPipelineAdapter:
    def test_crash_is_a_scored_outcome(self, monkeypatch):
        import evals.email_pipeline as pipeline

        def boom(*args, **kwargs):
            raise LookupError("forced")

        monkeypatch.setattr(pipeline, "classify", boom)
        p = predict_raw("1", b"From: a@b.example\r\nSubject: x\r\n\r\nhello\r\n", [])
        assert p.event == ERROR and p.error == "LookupError" and not p.surfaced

    def test_bad_charset_is_read_not_crashed(self):
        raw = (
            b"From: a@b.example\r\nSubject: x\r\n"
            b'Content-Type: text/plain; charset="x-unknown"\r\n\r\nhello\r\n'
        )
        p = predict_raw("1", raw, [])
        assert p.event != ERROR and "charset_fallback" in p.read_issues

    def test_excerpt_is_tag_free_single_line(self):
        out = excerpt(
            "<html><style>p{}</style><p>Hi&nbsp;Sam,</p>\n<p>We re​ceived it</p>"
        )
        assert out == "Hi Sam, We received it"
        assert len(excerpt("word " * 500)) == 300


def _row(
    exp,
    pred,
    exp_job=None,
    pred_job=None,
    surfaced=False,
    tid="t",
    exp_action=None,
    pred_action=None,
):
    return Scored(
        "x",
        tid,
        exp,
        exp_job,
        pred,
        pred_job,
        surfaced,
        expected_action=exp_action,
        predicted_action=pred_action,
    )


class TestScorecard:
    def test_precision_recall_and_confusion(self):
        card = score(
            [
                _row(REJECTED, REJECTED),
                _row(REJECTED, UNKNOWN),
                _row(INTERVIEW, REJECTED),
                _row(UNKNOWN, UNKNOWN),
            ]
        )
        rej = card.categories[REJECTED]
        assert (rej.support, rej.predicted, rej.true_positive) == (2, 2, 1)
        assert rej.precision.value == 0.5 and rej.recall.value == 0.5
        assert card.confusion[INTERVIEW][REJECTED] == 1
        assert card.good_news_as_rejected == 1
        assert card.missed_must_catch == 1
        assert card.event_accuracy.value == 0.5

    def test_job_metrics(self):
        card = score(
            [
                _row(APPLIED, APPLIED, "J01", "J01", surfaced=True),
                _row(APPLIED, APPLIED, "J01", "J02", surfaced=True),
                _row(APPLIED, APPLIED, "J01", None),
                _row(UNKNOWN, UNKNOWN, None, "J03"),
                _row(UNKNOWN, UNKNOWN, None, None),
            ]
        )
        j = card.jobs
        assert (j.with_job_correct, j.with_job_wrong, j.with_job_missed) == (1, 1, 1)
        assert j.false_match == 1 and j.wrong_job == 2
        assert j.surfaced_wrong_job == 1
        assert j.accuracy.value == 2 / 5

    def test_crashes_counted_but_not_a_precision_category(self):
        card = score([_row(APPLIED, ERROR), _row(APPLIED, APPLIED)])
        assert card.crashes == 1
        assert ERROR not in card.categories
        assert card.confusion[APPLIED][ERROR] == 1
        table = format_scorecard(card, title="t").split("confusion")[0]
        assert not any(line.startswith(ERROR) for line in table.splitlines())

    def test_wilson_interval(self):
        lo, hi = wilson(8, 10)
        assert round(lo, 3) == 0.490 and round(hi, 3) == 0.943
        assert wilson(0, 0) is None
        assert wilson(0, 5)[0] == 0.0 and wilson(5, 5)[1] == 1.0

    def test_card_actions_scored_separately_from_type(self):
        card = score(
            [
                # reminder: right type, but a move was proposed → unwanted
                _row(INTERVIEW, INTERVIEW, "J01", "J01", True, "r", None, "Interview"),
                # invite: right type, right move
                _row(
                    INTERVIEW,
                    INTERVIEW,
                    "J01",
                    "J01",
                    True,
                    "i",
                    "Interview",
                    "Interview",
                ),
                # right stage, wrong job → wrong move
                _row(
                    REJECTED, REJECTED, "J01", "J02", True, "w", "Rejected", "Rejected"
                ),
                # move due, nothing proposed → missed
                _row(APPLIED, APPLIED, "J01", None, False, "m", "Applied", None),
                _row(UNKNOWN, UNKNOWN),
            ]
        )
        c = card.cards
        assert (c.correct_moves, c.wrong_moves, c.missed_moves) == (1, 1, 1)
        assert (c.unwanted_moves, c.correct_no_change) == (1, 1)
        assert c.precision.value == 1 / 3 and c.recall.value == 1 / 3
        assert c.accuracy.value == 2 / 5
        assert card.event_accuracy.value == 1.0  # type was right every time
        assert c.confusion["no change"]["Interview"] == 1

    def test_full_synthetic_run_does_not_raise(self):
        jobs = [
            {"id": j.key, "company": j.company, "title": j.title} for j in SAVED_JOBS
        ]
        rows = []
        for e in generate(n=len(TEMPLATES)):
            p = predict_raw(e.id, e.raw, jobs)
            rows.append(
                Scored(
                    e.id,
                    e.template_id,
                    e.expected_event,
                    e.expected_job,
                    p.event,
                    p.job_id,
                    p.surfaced,
                    p.body_blank,
                    e.expected_action,
                    p.action,
                )
            )
        assert score(rows).total == len(TEMPLATES)


class TestLabelExport:
    JOBS = [
        {"id": "u-2", "company": "Orbweaver Analytics", "title": "Data Analyst"},
        {"id": "u-1", "company": "Brambleworks", "title": "Full Stack Developer"},
    ]

    def _read(self, path):
        with path.open(encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f))

    def test_writes_rows_with_blank_label_columns(self, tmp_path):
        msgs = [
            EmailMessage(
                uid="41",
                from_addr="Brambleworks Careers <careers@brambleworks.example>",
                subject="We received your application",
                body="<p>Thank you for applying to Brambleworks.</p>" + "x " * 400,
            ),
            EmailMessage(
                uid="42",
                from_addr="deals@ferncastle.example",
                subject='=HYPERLINK("http://bad.example")',
                body="Sale ends tonight",
                folder="Bulk",
                uidvalidity=9,
            ),
        ]
        out = tmp_path / "labels.csv"
        counts = write_label_export(
            [(msgs[0], "likely_job", "job_words"), (msgs[1], "sample_other", "bulk")],
            self.JOBS,
            out,
        )
        assert counts == {"likely_job": 1, "sample_other": 1}
        rows = self._read(out)
        assert [r["group"] for r in rows] == ["likely_job", "sample_other"]
        assert (rows[1]["folder"], rows[1]["uidvalidity"]) == ("Bulk", "9")
        assert rows[0]["filter_reason"] == "job_words"
        assert list(rows[0]) == EXPORT_COLUMNS
        assert rows[0]["predicted_event"] == APPLIED
        assert rows[0]["predicted_job"] == "J01"  # Brambleworks sorts first
        assert rows[0]["correct_label"] == rows[0]["correct_job"] == ""
        assert len(rows[0]["excerpt"]) <= 300 and "<p>" not in rows[0]["excerpt"]
        assert rows[1]["subject"].startswith("'=")  # formula neutralized
        assert rows[0]["id"] != rows[1]["id"]
        jobs = self._read(jobs_path_for(out))
        assert [(j["job_key"], j["saved_job_id"]) for j in jobs] == [
            ("J01", "u-1"),
            ("J02", "u-2"),
        ]

    def test_refuses_paths_git_would_track(self, tmp_path):
        with pytest.raises(ExportRefused):
            ensure_git_ignored(tmp_path / "labels.csv")  # not inside the repo
        with pytest.raises(ExportRefused):
            ensure_git_ignored(Path(__file__).with_name("labels.csv"))

    def test_accepts_the_ignored_export_dir(self):
        target = Path(__file__).resolve().parents[2] / "email_exports" / "probe.csv"
        ensure_git_ignored(target, jobs_path_for(target))


class TestQuoteFallbackSynthetic:
    def test_forwarded_mail_with_empty_note_falls_back_to_full_text(self):
        """A synthetic forward whose own note is empty: quote removal leaves
        nothing, so newest text must fall back to the full cleaned text."""
        from datetime import UTC, datetime

        from app.services.email_imap import _parse_message
        from evals.email_synthetic import Draft, render

        forwarded = Draft(
            "Alex Candidate",
            "alex.candidate@example.com",
            "Fwd: Your application to Orbweaver Analytics",
            "\n---------- Forwarded message ---------\n"
            "From: Orbweaver Careers <careers@orbweaver.example>\n\n"
            "We regret to inform you that we will not be proceeding with your "
            "application for Data Analyst.",
        )
        raw = render(
            forwarded, message_id="fwd-1", date=datetime(2026, 9, 1, tzinfo=UTC)
        )
        msg = _parse_message("1", raw)
        assert "quote_fallback" in msg.read_issues
        assert msg.newest_text == msg.body
        assert "regret to inform you" in msg.newest_text
