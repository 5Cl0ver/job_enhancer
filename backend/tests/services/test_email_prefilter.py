"""Header-only job filter: generous keeps, counted drops. Fictional data only."""

from app.services.email_imap import parse_header_block
from app.services.email_prefilter import (
    DROP_BULK,
    KEEP_JOB_WORDS,
    KEEP_PERSONAL,
    KEEP_PLATFORM,
    KEEP_SAVED_COMPANY,
    HeaderInfo,
    company_tokens,
    possible_job_email,
)

SAVED = company_tokens(
    ["Quillfeather Labs", "Kestrel & Finch", "The Copper Kettle Group"]
)


def _h(**kw) -> HeaderInfo:
    return HeaderInfo(**kw)


class TestKeeps:
    def test_platform_sender_kept_even_when_automated(self):
        h = _h(
            from_addr="no-reply@us.greenhouse-mail.io",
            subject="Update",
            auto_submitted="auto-generated",
        )
        assert possible_job_email(h, SAVED) == (True, KEEP_PLATFORM)

    def test_platform_reply_to_counts(self):
        h = _h(
            from_addr="careers@unknown.example",
            reply_to="x@myworkdayjobs.com",
            subject="Hi",
            list_unsubscribe="<x>",
        )
        assert possible_job_email(h)[0]

    def test_job_words_in_subject_or_sender_name(self):
        for subj in [
            "Your application",
            "Interview invitation",
            "Next steps",
            "Offer of employment",
            "Take-home assignment",
        ]:
            h = _h(from_addr="news@shop.example", subject=subj, list_unsubscribe="<x>")
            assert possible_job_email(h) == (True, KEEP_JOB_WORDS), subj
        h = _h(
            from_addr="Vantorra Talent Team <noreply@vantorra.example>",
            subject="Hello",
            list_unsubscribe="<x>",
        )
        assert possible_job_email(h) == (True, KEEP_JOB_WORDS)

    def test_saved_company_domain(self):
        h = _h(
            from_addr="noreply@mail.quillfeather.example",
            subject="Hello",
            list_unsubscribe="<x>",
        )
        assert possible_job_email(h, SAVED) == (True, KEEP_SAVED_COMPANY)
        h = _h(
            from_addr="noreply@kestrelfinch.example",
            subject="Hello",
            list_unsubscribe="<x>",
        )
        assert possible_job_email(h, SAVED) == (True, KEEP_SAVED_COMPANY)

    def test_common_word_company_does_not_match_every_domain(self):
        # "The Copper Kettle Group" must not keep mail from "group.example".
        h = _h(from_addr="deals@group.example", subject="Sale", list_unsubscribe="<x>")
        assert possible_job_email(h, SAVED) == (False, DROP_BULK)

    def test_personal_mail_is_kept(self):
        h = _h(
            from_addr="Priya Okafor <priya@hollowreed.example>",
            subject="Quick question",
        )
        assert possible_job_email(h) == (True, KEEP_PERSONAL)


class TestDrops:
    def test_bulk_without_job_signal_dropped(self):
        for h in [
            _h(
                from_addr="deals@ferncastle.example",
                subject="30% off tonight",
                list_unsubscribe="<x>",
            ),
            _h(from_addr="orders@ferncastle.example", subject="Your order shipped"),
            _h(
                from_addr="news@yarrowby.example",
                subject="Storage almost full",
                precedence="bulk",
            ),
            _h(
                from_addr="someone@yarrowby.example",
                subject="Digest",
                list_id="<l.example>",
            ),
        ]:
            assert possible_job_email(h) == (False, DROP_BULK), h

    def test_parse_header_block_feeds_the_filter(self):
        raw = (
            b"From: Ferncastle <deals@ferncastle.example>\r\nSubject: =?utf-8?q?Sale_=E2=80=94_ends?=\r\n"
            b"List-Unsubscribe: <mailto:u@ferncastle.example>\r\n\r\n"
        )
        h = parse_header_block(raw)
        assert h.subject == "Sale \u2014 ends" and h.is_bulk
        assert possible_job_email(h) == (False, DROP_BULK)
