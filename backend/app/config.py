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
    # NVIDIA NIM model id. Defaults to the fast 8B model: on the free tier the
    # 70B models are frequently queued and can take >60s (or time out), which
    # hangs document generation. Override with NVIDIA_MODEL to use a larger model
    # when the free tier has capacity (e.g. meta/llama-3.3-70b-instruct).
    nvidia_model: str = "meta/llama-3.1-8b-instruct"

    # Job APIs
    adzuna_app_id: str
    adzuna_app_key: str
    jsearch_api_key: str

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
