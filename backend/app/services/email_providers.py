"""Email provider detection + IMAP connection presets.

Given a user's email address we pick the right way to connect their inbox:

* Known webmail hosts (Yahoo, iCloud, AOL) get a ready IMAP host/port and a
  ``guide`` key so the UI can show the exact app-password steps.
* Google / Microsoft are flagged ``connect_method="oauth"`` for the one-click
  "Sign in" button added later — they still expose an IMAP host as a fallback.
* Proton has no direct IMAP (needs paid Bridge), so it's ``"forward"`` and the
  UI offers the auto-forward workaround.
* Anything unrecognized falls back to a generic IMAP form the user fills in.

Pure functions, no network — fully unit-testable.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

# connect_method values the frontend branches on.
APP_PASSWORD = "app_password"  # guided app-password + IMAP (works everywhere)
OAUTH = "oauth"  # one-click Google/Microsoft button (added later)
FORWARD = "forward"  # no IMAP; user forwards mail to us (Proton et al.)


@dataclass(frozen=True)
class ProviderInfo:
    provider: str  # stable key we store ("yahoo", "gmail", "imap"…)
    label: str  # human name for the UI ("Yahoo Mail")
    connect_method: str  # APP_PASSWORD | OAUTH | FORWARD
    imap_host: str  # "" when not applicable (Proton)
    imap_port: int
    guide: str  # setup-guide key for the UI ("" if none)

    def as_dict(self) -> dict:
        return asdict(self)


# Per-provider connection facts. ``imap`` is the generic fallback.
_PROVIDERS: dict[str, ProviderInfo] = {
    "yahoo": ProviderInfo(
        "yahoo", "Yahoo Mail", APP_PASSWORD, "imap.mail.yahoo.com", 993, "yahoo"
    ),
    "aol": ProviderInfo("aol", "AOL Mail", APP_PASSWORD, "imap.aol.com", 993, "aol"),
    "icloud": ProviderInfo(
        "icloud", "iCloud Mail", APP_PASSWORD, "imap.mail.me.com", 993, "icloud"
    ),
    "gmail": ProviderInfo("gmail", "Gmail", OAUTH, "imap.gmail.com", 993, "gmail"),
    "outlook": ProviderInfo(
        "outlook", "Outlook", OAUTH, "outlook.office365.com", 993, "outlook"
    ),
    "proton": ProviderInfo("proton", "Proton Mail", FORWARD, "", 993, "proton"),
    "imap": ProviderInfo("imap", "Other (IMAP)", APP_PASSWORD, "", 993, "generic"),
}

# Which webmail domains map to which provider preset.
_DOMAIN_TO_PROVIDER: dict[str, str] = {
    "yahoo.com": "yahoo",
    "ymail.com": "yahoo",
    "rocketmail.com": "yahoo",
    "aol.com": "aol",
    "icloud.com": "icloud",
    "me.com": "icloud",
    "mac.com": "icloud",
    "gmail.com": "gmail",
    "googlemail.com": "gmail",
    "outlook.com": "outlook",
    "hotmail.com": "outlook",
    "live.com": "outlook",
    "msn.com": "outlook",
    "proton.me": "proton",
    "protonmail.com": "proton",
    "pm.me": "proton",
}


def detect_provider(email_address: str) -> ProviderInfo:
    """Pick the connection preset for an email address by its domain.

    Unknown domains return the generic ``imap`` preset (blank host — the user
    supplies it), so we always return *something* usable.
    """
    domain = (email_address or "").rsplit("@", 1)[-1].strip().lower()
    provider = _DOMAIN_TO_PROVIDER.get(domain, "imap")
    return _PROVIDERS[provider]


def get_provider(provider: str) -> ProviderInfo:
    """Look up a preset by its stable key, falling back to generic IMAP."""
    return _PROVIDERS.get(provider, _PROVIDERS["imap"])
