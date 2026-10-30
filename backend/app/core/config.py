from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import URL

BACKEND_DIR = Path(__file__).resolve().parents[2]
INSECURE_DEFAULT_SECRET = "change-me-in-local-env"  # noqa: S105 - sentinel, rejected in production


class Settings(BaseSettings):
    """Application configuration loaded from environment variables and `backend/.env`."""

    # backend/.env regardless of the working directory the server or Alembic is started from.
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "WorkPulse API"
    app_env: Literal["development", "test", "production"] = "development"
    app_version: str = "0.1.0"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_name: str = "workpulse"
    db_user: str = "workpulse_app"
    db_password: SecretStr = SecretStr("")
    db_test_name: str | None = None

    # Comma-separated in the environment, e.g. FRONTEND_ORIGINS=http://localhost:5173
    frontend_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )
    session_secret: SecretStr = SecretStr(INSECURE_DEFAULT_SECRET)
    session_idle_minutes: int = Field(default=12 * 60, ge=5)
    session_absolute_minutes: int = Field(default=7 * 24 * 60, ge=60)
    # None → Secure cookies only in production. Override for HTTPS staging.
    cookie_secure: bool | None = None
    password_reset_ttl_minutes: int = Field(default=60, ge=5, le=24 * 60)

    # Public URL of the SPA, used to build links in emails.
    frontend_base_url: str = "http://localhost:5173"
    mail_backend: Literal["console", "smtp"] = "console"
    mail_from: str = "WorkPulse <no-reply@workpulse.local>"

    @field_validator("frontend_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def validate_production(self) -> "Settings":
        if self.app_env != "production":
            return self
        problems = []
        secret = self.session_secret.get_secret_value()
        if secret == INSECURE_DEFAULT_SECRET or len(secret) < 32:
            problems.append("SESSION_SECRET must be a random value of at least 32 characters")
        if not self.db_password.get_secret_value():
            problems.append("DB_PASSWORD must be set")
        if any(not origin.startswith("https://") for origin in self.frontend_origins):
            problems.append("FRONTEND_ORIGINS must use https:// in production")
        if not self.frontend_base_url.startswith("https://"):
            problems.append("FRONTEND_BASE_URL must use https:// in production")
        if self.mail_backend == "console":
            problems.append("MAIL_BACKEND=console would write password-reset links to logs")
        if self.cookie_secure is False:
            problems.append("COOKIE_SECURE cannot be false in production")
        if problems:
            raise ValueError("Invalid production configuration: " + "; ".join(problems))
        return self

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def secure_cookies(self) -> bool:
        return self.is_production if self.cookie_secure is None else self.cookie_secure

    def database_url(self, *, test: bool = False) -> URL:
        name = self.db_test_name if test and self.db_test_name else self.db_name
        return URL.create(
            drivername="mysql+pymysql",
            username=self.db_user,
            password=self.db_password.get_secret_value() or None,
            host=self.db_host,
            port=self.db_port,
            database=name,
            query={"charset": "utf8mb4"},
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
