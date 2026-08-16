"""Unit tests for the at-rest secret encryption helper."""

import pytest
from cryptography.fernet import Fernet, InvalidToken

from app.config import settings
from app.utils import crypto


@pytest.fixture
def enc_key(monkeypatch):
    """Give the process a real Fernet key for the duration of a test."""
    key = Fernet.generate_key().decode()
    monkeypatch.setattr(settings, "mail_enc_key", key)
    return key


class TestCrypto:
    def test_round_trip(self, enc_key):
        secret = "abcd-efgh-ijkl-mnop"  # a Yahoo-style app password
        token = crypto.encrypt(secret)
        assert token != secret  # stored form is not the plaintext
        assert crypto.decrypt(token) == secret

    def test_ciphertext_is_not_plaintext_anywhere(self, enc_key):
        secret = "super-secret-value"
        token = crypto.encrypt(secret)
        assert secret not in token

    def test_encrypt_is_nondeterministic(self, enc_key):
        # Fernet embeds a random IV, so the same input encrypts differently each
        # time — a token can't be used to test-guess the plaintext.
        assert crypto.encrypt("same") != crypto.encrypt("same")

    def test_wrong_key_cannot_decrypt(self, enc_key, monkeypatch):
        token = crypto.encrypt("value")
        monkeypatch.setattr(settings, "mail_enc_key", Fernet.generate_key().decode())
        with pytest.raises(InvalidToken):
            crypto.decrypt(token)

    def test_disabled_without_key(self, monkeypatch):
        monkeypatch.setattr(settings, "mail_enc_key", "")
        assert crypto.encryption_available() is False
        with pytest.raises(crypto.EncryptionUnavailable):
            crypto.encrypt("value")

    def test_available_with_key(self, enc_key):
        assert crypto.encryption_available() is True
