"""Unit tests for the pure RFC822 → EmailMessage parsing (no network)."""

from app.services.email_imap import _parse_message


class TestParseMessage:
    def test_plain_text(self):
        raw = (
            b"From: Acme Talent <talent@acme.com>\r\n"
            b"Subject: Interview with Acme\r\n"
            b"Content-Type: text/plain; charset=utf-8\r\n"
            b"\r\n"
            b"We'd like to schedule a call. What's your availability?\r\n"
        )
        msg = _parse_message("7", raw)
        assert msg.uid == "7"
        assert "talent@acme.com" in msg.from_addr
        assert msg.subject == "Interview with Acme"
        assert "schedule a call" in msg.body

    def test_mime_encoded_subject_is_decoded(self):
        raw = (
            b"From: hr@globex.com\r\n"
            b"Subject: =?utf-8?q?Congratulations_=E2=80=94_Offer?=\r\n"
            b"\r\n"
            b"Body.\r\n"
        )
        msg = _parse_message("1", raw)
        assert "Offer" in msg.subject
        assert "—" in msg.subject  # em dash decoded

    def test_multipart_prefers_plain_text(self):
        raw = (
            b"From: no-reply@acme.com\r\n"
            b"Subject: Update\r\n"
            b'Content-Type: multipart/alternative; boundary="B"\r\n'
            b"\r\n"
            b"--B\r\n"
            b"Content-Type: text/plain; charset=utf-8\r\n"
            b"\r\n"
            b"Unfortunately we will not be moving forward.\r\n"
            b"--B\r\n"
            b"Content-Type: text/html; charset=utf-8\r\n"
            b"\r\n"
            b"<p>Unfortunately we will not be moving forward.</p>\r\n"
            b"--B--\r\n"
        )
        msg = _parse_message("2", raw)
        assert "Unfortunately" in msg.body
        assert "<p>" not in msg.body  # took the text/plain part
