"""Links from a detected email to the message itself in the user's webmail."""

from app.services.email_scan import email_id_of, mail_link, mail_search_link

EMAIL_ID = "AHv3_oRrlHYyYacYYwjlWCQNEtA"  # the shape Yahoo's IMAP server gives


class TestExactLink:
    def test_yahoo_inbox_mail_opens_the_message_itself(self):
        link = mail_link(
            "yahoo", subject="Interview", email_id=EMAIL_ID, folder="INBOX"
        )
        assert link == f"https://mail.yahoo.com/d/folders/1/messages/{EMAIL_ID}"

    def test_aol_uses_its_own_site(self):
        link = mail_link("aol", subject="Interview", email_id=EMAIL_ID, folder="Inbox")
        assert link == f"https://mail.aol.com/d/folders/1/messages/{EMAIL_ID}"

    def test_gmail_opens_the_message_by_its_message_id(self):
        link = mail_link("gmail", "<abc123@mail.vellacor.example>", "Interview")
        assert link.endswith("#search/rfc822msgid:abc123%40mail.vellacor.example")

    def test_an_id_cannot_break_out_of_the_address(self):
        link = mail_link("yahoo", email_id="AA/../x?y=1", folder="INBOX")
        assert link == "https://mail.yahoo.com/d/folders/1/messages/AA%2F..%2Fx%3Fy%3D1"


class TestFallsBackToASearch:
    def test_mail_outside_the_inbox(self):
        # Only the inbox's folder number is known, so spam mail gets a search.
        link = mail_link(
            "yahoo",
            subject="Your application",
            email_id=EMAIL_ID,
            folder="Bulk",
            from_addr="Talent <talent@vellacor.example>",
        )
        assert link == mail_search_link(
            "yahoo", "Your application", "Talent <talent@vellacor.example>"
        )
        assert "/d/search/keyword=" in link

    def test_no_server_id(self):
        link = mail_link("yahoo", subject="Your application", folder="INBOX")
        assert link == "https://mail.yahoo.com/d/search/keyword=Your%20application"

    def test_the_search_adds_the_sender_so_shared_subjects_land_right(self):
        link = mail_search_link(
            "yahoo", "Thank you for applying", "Talent <talent@vellacor.example>"
        )
        assert link.endswith(
            "keyword=Thank%20you%20for%20applying%20talent%40vellacor.example"
        )
        gmail = mail_search_link(
            "gmail", "Thank you for applying", "talent@vellacor.example"
        )
        assert "from%3Atalent%40vellacor.example" in gmail

    def test_other_providers_have_no_link(self):
        assert (
            mail_link("outlook", subject="Hi", email_id=EMAIL_ID, folder="INBOX")
            is None
        )
        assert mail_search_link("outlook", "Hi") is None


class TestEmailIdOf:
    def test_reads_the_server_id_from_the_stored_key(self):
        assert email_id_of(f"emailid:{EMAIL_ID}") == EMAIL_ID

    def test_other_keys_have_none(self):
        assert email_id_of("msgid:abc|hash") == ""
        assert email_id_of(None) == ""
