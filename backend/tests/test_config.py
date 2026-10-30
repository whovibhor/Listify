import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_frontend_origins_accepts_comma_separated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FRONTEND_ORIGINS", "http://localhost:5173, http://127.0.0.1:5173")

    settings = Settings(_env_file=None)

    assert settings.frontend_origins == ["http://localhost:5173", "http://127.0.0.1:5173"]


def test_production_rejects_insecure_defaults() -> None:
    with pytest.raises(ValidationError) as exc_info:
        Settings(_env_file=None, app_env="production", frontend_origins=["http://app.example"])

    message = str(exc_info.value)
    assert "SESSION_SECRET" in message
    assert "DB_PASSWORD" in message
    assert "https://" in message


def test_production_accepts_secure_configuration() -> None:
    settings = Settings(
        _env_file=None,
        app_env="production",
        session_secret="x" * 48,
        db_password="not-empty",
        frontend_origins=["https://app.listify.example"],
        frontend_base_url="https://app.listify.example",
        mail_backend="smtp",
    )
    assert settings.is_production
    assert settings.secure_cookies


def test_production_rejects_console_mailer_and_insecure_cookies() -> None:
    with pytest.raises(ValidationError) as exc_info:
        Settings(
            _env_file=None,
            app_env="production",
            session_secret="x" * 48,
            db_password="not-empty",
            frontend_origins=["https://app.listify.example"],
            frontend_base_url="https://app.listify.example",
            mail_backend="console",
            cookie_secure=False,
            rate_limits_enabled=False,
        )
    message = str(exc_info.value)
    assert "MAIL_BACKEND" in message
    assert "COOKIE_SECURE" in message
    assert "RATE_LIMITS_ENABLED" in message


def test_database_url_never_renders_password_by_default() -> None:
    settings = Settings(_env_file=None, db_password="s3cr3t!@#", db_name="listify")

    url = settings.database_url()

    assert "s3cr3t" not in str(url)
    assert url.password == "s3cr3t!@#"
    assert url.drivername == "mysql+pymysql"
    assert url.query["charset"] == "utf8mb4"


def test_database_url_uses_test_db_name_when_requested() -> None:
    settings = Settings(_env_file=None, db_name="listify", db_test_name="listify_test")
    assert settings.database_url(test=True).database == "listify_test"
    assert settings.database_url().database == "listify"
