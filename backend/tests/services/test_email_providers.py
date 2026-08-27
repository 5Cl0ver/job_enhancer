"""Unit tests for email provider detection + IMAP presets."""

from app.services.email_providers import (
    APP_PASSWORD,
    FORWARD,
    OAUTH,
    detect_provider,
    get_provider,
)


class TestDetect:
    def test_yahoo_gets_app_password_and_imap_host(self):
        p = detect_provider("someone@yahoo.com")
        assert p.provider == "yahoo"
        assert p.connect_method == APP_PASSWORD
        assert p.imap_host == "imap.mail.yahoo.com"
        assert p.guide == "yahoo"

    def test_yahoo_aliases(self):
        assert detect_provider("a@ymail.com").provider == "yahoo"
        assert detect_provider("a@rocketmail.com").provider == "yahoo"

    def test_gmail_is_oauth_but_keeps_imap_fallback(self):
        p = detect_provider("me@gmail.com")
        assert p.provider == "gmail"
        assert p.connect_method == OAUTH
        assert p.imap_host == "imap.gmail.com"  # still usable as a fallback

    def test_outlook_family_is_oauth(self):
        for addr in ("a@outlook.com", "a@hotmail.com", "a@live.com", "a@msn.com"):
            assert detect_provider(addr).connect_method == OAUTH

    def test_icloud_aliases(self):
        for addr in ("a@icloud.com", "a@me.com", "a@mac.com"):
            assert detect_provider(addr).provider == "icloud"

    def test_proton_has_no_imap_and_uses_forwarding(self):
        p = detect_provider("private@proton.me")
        assert p.connect_method == FORWARD
        assert p.imap_host == ""  # can't connect directly

    def test_unknown_domain_falls_back_to_generic_imap(self):
        p = detect_provider("dev@my-company.io")
        assert p.provider == "imap"
        assert p.connect_method == APP_PASSWORD
        assert p.imap_host == ""  # user supplies it

    def test_case_and_whitespace_insensitive(self):
        assert detect_provider("  Someone@YAHOO.com ").provider == "yahoo"

    def test_as_dict_is_json_friendly(self):
        d = detect_provider("a@yahoo.com").as_dict()
        assert d["provider"] == "yahoo" and d["imap_port"] == 993


class TestGetProvider:
    def test_lookup_by_key(self):
        assert get_provider("aol").imap_host == "imap.aol.com"

    def test_unknown_key_falls_back_to_generic(self):
        assert get_provider("nope").provider == "imap"
