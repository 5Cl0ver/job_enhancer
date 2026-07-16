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

    # Auth — Supabase project JWT secret (Settings -> API -> JWT Secret)
    supabase_jwt_secret: str
    supabase_url: str = ""

    # AI
    nvidia_api_key: str

    # Job APIs
    adzuna_app_id: str
    adzuna_app_key: str
    jsearch_api_key: str

    # Server
    debug: bool = False
    allowed_origins: list[str] = ["http://localhost:3000"]
    admin_email: str = ""

    @property
    def cors_origins(self) -> list[str]:
        return self.allowed_origins


settings = Settings()  # type: ignore[call-arg]
