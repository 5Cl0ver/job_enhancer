"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    database_url: str

    # Auth — Supabase project. Tokens are verified against the project's public
    # JWKS at {supabase_url}/auth/v1/.well-known/jwks.json, so supabase_url is
    # required. supabase_jwt_secret is legacy (HS256) and no longer used.
    supabase_url: str
    supabase_jwt_secret: str = ""

    # AI
    nvidia_api_key: str
    # NVIDIA NIM model id. NOTE: NVIDIA retires models on an EOL schedule — the
    # old llama-3.1-8b / llama-3.3-70b instruct ids are now [410] Gone, which
    # silently breaks autofill (résumé parsing + field mapping). This 11B model
    # is available on the free tier, returns clean (non-reasoning) output, and is
    # fast enough for interactive autofill. Override with NVIDIA_MODEL if needed;
    # verify a candidate first: GET https://integrate.api.nvidia.com/v1/models.
    nvidia_model: str = "meta/llama-3.2-11b-vision-instruct"

    # Job APIs — OPTIONAL. Adzuna + JSearch need keys; without them those two
    # sources just return nothing (the app still aggregates from the keyless
    # sources: Remotive, RemoteOK, Jobicy, The Muse). Empty = source disabled.
    adzuna_app_id: str = ""
    adzuna_app_key: str = ""
    jsearch_api_key: str = ""

    # Email auto-status. Fernet key (url-safe base64, 32 bytes) used to encrypt
    # a user's mailbox app-password at rest before it's stored in the database.
    # Generate one with `python -c "from cryptography.fernet import Fernet;
    # print(Fernet.generate_key().decode())"` and keep it OUT of the repo. Empty
    # disables the whole email-connect feature (we refuse to store a plaintext
    # secret), so connecting an inbox is off until this is configured.
    mail_enc_key: str = ""

    # MCP connector (Claude custom connector). The PUBLIC ORIGIN of the backend,
    # WITHOUT a path — e.g. "https://job-enhancer.onrender.com". FastMCP appends
    # the "/mcp" endpoint path itself, so the URL the user pastes into Claude is
    # this value + "/mcp". Empty disables the connector (skips mounting it).
    mcp_public_url: str = ""

    # Server
    debug: bool = False
    # Comma-separated origins in .env (e.g. "http://localhost:5173,http://x.com").
    # Kept as a plain string so pydantic-settings doesn't try to JSON-parse it.
    allowed_origins: str = "http://localhost:5173"
    admin_email: str = ""

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()  # type: ignore[call-arg]
