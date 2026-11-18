"""Tests for reading email text: charset fallback, HTML → text, hidden-text and
zero-width removal, newest-vs-full splitting, read issues. All data fictional."""

import email

from app.services.email_imap import _parse_message, read_stats
from app.services.email_scan import EmailMessage
from app.services.email_text import (
    BLANK,
    CHARSET_FALLBACK,
    HIDDEN_REMOVED,
    HTML_CONVERTED,
    LOSSY_DECODE,
    NO_TEXT_PART,
    PARSE_FAILED,
    QUOTE_FALLBACK,
    clean_header,
    decode_bytes,
    html_to_text,
    newest_text,
    normalize,
    read_message,
)


def _msg(body: bytes, ctype: str = "text/plain", charset: str = "utf-8") -> bytes:
    return (
        b"From: Orbweaver Careers <careers@orbweaver.example>\r\n"
        b"Subject: Your application\r\n"
        + f'Content-Type: {ctype}; charset="{charset}"\r\n\r\n'.encode()
        + body
    )


class TestDecodeBytes:
    def test_declared_charset_used_without_fallback(self):
        text, issues = decode_bytes("We won’t".encode("cp1252"), "windows-1252")
        assert text == "We won’t" and not issues

    def test_unknown_charset_falls_back_to_utf8(self):
        text, issues = decode_bytes("café".encode(), "x-unknown")
        assert text == "café" and issues == {CHARSET_FALLBACK}

    def test_mislabeled_ascii_falls_back(self):
        text, issues = decode_bytes("won’t".encode(), "us-ascii")
        assert text == "won’t" and CHARSET_FALLBACK in issues

    def test_undeclared_latin_bytes_use_cp1252(self):
        text, issues = decode_bytes(b"caf\xe9", None)
        assert text == "café" and issues == {CHARSET_FALLBACK}

    def test_never_raises(self):
        # 0x81 is undefined in cp1252 and invalid UTF-8 → lossy, still text.
        text, issues = decode_bytes(b"ok \x81 ok", "x-unknown")
        assert "ok" in text and {CHARSET_FALLBACK, LOSSY_DECODE} <= issues


class TestHtmlToText:
    def test_blocks_become_lines_and_entities_decode(self):
        text, hidden = html_to_text(
            "<p>Hi Sam,</p><p>We won&#8217;t be moving&nbsp;forward.</p>"
            "<table><tr><td>Role</td><td>Data Analyst</td></tr></table>"
        )
        lines = normalize(text).splitlines()
        assert "Hi Sam," in lines
        assert "We won't be moving forward." in lines
        assert "Role Data Analyst" in lines
        assert not hidden

    def test_scripts_styles_comments_dropped(self):
        text, _ = html_to_text(
            "<head><title>T</title><style>p{color:red}</style></head>"
            "<body><script>alert(1)</script><!-- tracking -->Visible</body>"
        )
        assert normalize(text) == "Visible"

    def test_hidden_elements_dropped(self):
        hidden_variants = [
            '<div style="display:none">X</div>',
            '<span style="visibility: hidden">X</span>',
            '<div style="font-size:0px;line-height:0">X</div>',
            '<div style="opacity:0">X</div>',
            '<div style="max-height:0;overflow:hidden">X</div>',
            '<div style="mso-hide:all">X</div>',
            "<div hidden>X</div>",
        ]
        for variant in hidden_variants:
            text, hidden = html_to_text(f"<p>Shown</p>{variant}<p>Also shown</p>")
            assert "X" not in text, variant
            assert "Shown" in text and "Also shown" in text
            assert hidden, variant

    def test_visible_styles_kept(self):
        text, hidden = html_to_text(
            '<p style="font-size:14px;opacity:0.9">Real text</p>'
        )
        assert "Real text" in text and not hidden

    def test_unclosed_tags_do_not_hide_the_rest(self):
        text, _ = html_to_text(
            '<div style="display:none"><p>preheader</div><p>Interview on Tuesday'
        )
        assert "Interview on Tuesday" in text and "preheader" not in text

    def test_images_and_links_are_not_fetched_or_shown(self):
        text, _ = html_to_text(
            '<img src="https://track.example/p.gif" alt="logo">'
            '<a href="https://track.example/unsub">Unsubscribe</a>'
        )
        assert "track.example" not in text and "logo" not in text
        assert "Unsubscribe" in text

    def test_blockquote_marked_as_quoted(self):
        text, _ = html_to_text(
            "<p>Tuesday works.</p><blockquote><p>Old line one</p>"
            "<p>Old line two</p></blockquote>"
        )
        full = normalize(text)
        assert "> Old line one" in full
        assert newest_text(full) == "Tuesday works."


class TestNormalize:
    def test_zero_width_removed(self):
        assert normalize("appli​cation re‌ceived﻿") == ("application received")

    def test_typographic_quotes_and_spaces_plain(self):
        assert normalize("won’t be “selected”") == ('won\'t be "selected"')

    def test_whitespace_tidied(self):
        assert normalize("a  \t b\r\n\r\n\r\n\r\nc  ") == "a b\n\nc"

    def test_clean_header(self):
        assert clean_header("Appli​cation\n received") == "Application received"


class TestNewestText:
    def test_gmail_style_quote(self):
        full = (
            "Great, Tuesday works.\n\nOn Mon, Sep 7, 2026, Priya Okafor wrote:\n"
            "> Unfortunately our manager is out."
        )
        assert newest_text(full) == "Great, Tuesday works."

    def test_wrapped_on_wrote_line(self):
        full = "See you then.\nOn Mon, Sep 7, 2026 at 9:00 AM Priya Okafor <p@x.example>\nwrote:\n> old"
        assert newest_text(full) == "See you then."

    def test_outlook_original_message(self):
        full = "Thanks!\n-----Original Message-----\nFrom: a\nSent: b\nold text"
        assert newest_text(full) == "Thanks!"

    def test_outlook_from_sent_header(self):
        full = "Thanks!\nFrom: Priya Okafor\nSent: Monday\nSubject: x\nold"
        assert newest_text(full) == "Thanks!"

    def test_sentence_starting_with_on_is_not_a_quote(self):
        full = "On Monday the team will review your application."
        assert newest_text(full) == full


class TestReadMessage:
    def test_plain_text_has_no_issues(self):
        r = read_message(email.message_from_bytes(_msg(b"Thanks for applying.")))
        assert r.full == r.newest == "Thanks for applying." and not r.issues

    def test_quote_fallback_when_reply_is_empty(self):
        body = b"On Mon, Sep 7, 2026, Priya wrote:\r\n> We regret to inform you.\r\n"
        r = read_message(email.message_from_bytes(_msg(body)))
        assert r.newest == r.full and QUOTE_FALLBACK in r.issues

    def test_newest_separate_from_full(self):
        body = (
            b"Thanks, Tuesday at 2pm works for the interview.\r\n\r\n"
            b"On Mon, Sep 7, 2026, Priya wrote:\r\n> Unfortunately the manager is out.\r\n"
        )
        r = read_message(email.message_from_bytes(_msg(body)))
        assert "Unfortunately" in r.full and "Unfortunately" not in r.newest
        assert QUOTE_FALLBACK not in r.issues

    def test_html_only_with_hidden_preheader(self):
        html = (
            b'<html><body><div style="display:none">Book a time today</div>'
            b"<p>Your storage is almost full.</p></body></html>"
        )
        r = read_message(email.message_from_bytes(_msg(html, "text/html")))
        assert r.full == "Your storage is almost full."
        assert {HTML_CONVERTED, HIDDEN_REMOVED} <= set(r.issues)

    def test_empty_plain_part_falls_back_to_html(self):
        raw = (
            b'From: a@b.example\r\nSubject: s\r\nContent-Type: multipart/alternative; boundary="B"\r\n\r\n'
            b"--B\r\nContent-Type: text/plain\r\n\r\n \r\n"
            b"--B\r\nContent-Type: text/html\r\n\r\n<p>Real content</p>\r\n--B--\r\n"
        )
        r = read_message(email.message_from_bytes(raw))
        assert r.full == "Real content"

    def test_attachment_only_is_explained_blank(self):
        raw = (
            b'From: a@b.example\r\nSubject: s\r\nContent-Type: multipart/mixed; boundary="M"\r\n\r\n'
            b"--M\r\nContent-Type: application/pdf\r\n"
            b'Content-Disposition: attachment; filename="a.pdf"\r\n'
            b"Content-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK\r\n--M--\r\n"
        )
        r = read_message(email.message_from_bytes(raw))
        assert r.full == "" and {BLANK, NO_TEXT_PART} <= set(r.issues)

    def test_parse_message_cleans_subject_and_keeps_newest(self):
        raw = _msg(b"Hi.\r\n").replace(
            b"Subject: Your application", "Subject: Appli​cation".encode()
        )
        msg = _parse_message("9", raw)
        assert msg.subject == "Application"
        assert msg.newest_text == "Hi."


class TestReadStats:
    def test_counts(self):
        msgs = [
            EmailMessage("1", "", "", "x", read_issues=(CHARSET_FALLBACK,)),
            EmailMessage("2", "", "", "", read_issues=(BLANK, NO_TEXT_PART)),
            EmailMessage("3", "", "", "", read_issues=(BLANK,)),
            EmailMessage("4", "", "", "", read_issues=(PARSE_FAILED,)),
            EmailMessage("5", "", "", "y"),
        ]
        s = read_stats(msgs)
        assert (s.total, s.failed, s.blank, s.blank_unexplained) == (5, 1, 2, 1)
        assert s.charset_fallback == 1
