from argparse import Namespace
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.common.mailer import OutboxMailer, get_mailer
from app.common.storage import LocalStorage, get_storage
from app.core.config import BACKEND_DIR, Settings, get_settings
from app.db.base import Base
from app.db.session import build_engine, get_db
from app.main import create_app
from app.modules.auth.tokens import CSRF_COOKIE, CSRF_HEADER

# Migration-seeded reference data stays between tests; only user data is cleared.
SEEDED_TABLES = {"roles", "permissions", "role_permissions"}


@pytest.fixture
def settings() -> Settings:
    # DB credentials come from backend/.env; everything behavioral is pinned here.
    return Settings(
        app_env="test",
        frontend_origins=["http://localhost:5173"],
        frontend_base_url="http://localhost:5173",
        mail_backend="console",
        cookie_secure=False,
    )


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    application = create_app(settings)
    application.dependency_overrides[get_settings] = lambda: settings
    return application


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


# --- MySQL-backed fixtures (listify_test) -------------------------------------------------


@pytest.fixture(scope="session")
def test_engine() -> Iterator[Engine]:
    engine = build_engine(test=True)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        pytest.skip(f"MySQL test database not reachable: {type(exc).__name__}")
    # Build the schema through the real migrations so they are exercised on every run.
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.cmd_opts = Namespace(x=["test=true"])
    command.upgrade(config, "head")
    yield engine
    engine.dispose()


@pytest.fixture
def db_sessionmaker(test_engine: Engine) -> Iterator[sessionmaker[Session]]:
    factory = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)
    yield factory
    with test_engine.begin() as connection:
        connection.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
        # DELETE, not TRUNCATE: TRUNCATE recreates each table, which costs about a second per test.
        for table in Base.metadata.sorted_tables:
            if table.name not in SEEDED_TABLES:
                connection.execute(table.delete())
        connection.execute(text("SET FOREIGN_KEY_CHECKS = 1"))


@pytest.fixture
def db(db_sessionmaker: sessionmaker[Session]) -> Iterator[Session]:
    """A session for arranging and asserting database state directly."""
    with db_sessionmaker() as session:
        yield session


@pytest.fixture
def outbox() -> OutboxMailer:
    return OutboxMailer()


# 20:00 UTC on 29 Oct 2026 = 01:30 on 30 Oct in Asia/Kolkata (the default test user's zone),
# so "today" for the user differs from the UTC date: a good trap for timezone bugs.
FROZEN_NOW = datetime(2026, 10, 29, 20, 0)


@pytest.fixture
def frozen_now(monkeypatch: pytest.MonkeyPatch) -> datetime:
    """Pins the clock used by task and dashboard endpoints."""
    for target in ("app.modules.tasks.router.utc_now", "app.modules.dashboards.router.utc_now"):
        monkeypatch.setattr(target, lambda: FROZEN_NOW)
    return FROZEN_NOW


class ApiClient(TestClient):
    """TestClient that behaves like the SPA: echoes the CSRF cookie on unsafe requests."""

    def request(self, method: str, url: Any, *args: Any, **kwargs: Any) -> Any:  # type: ignore[override]
        if method.upper() not in {"GET", "HEAD", "OPTIONS"}:
            if CSRF_COOKIE not in self.cookies:
                super().request("GET", "/api/v1/auth/csrf")
            headers = dict(kwargs.pop("headers", None) or {})
            headers.setdefault(CSRF_HEADER, self.cookies.get(CSRF_COOKIE, ""))
            kwargs["headers"] = headers
        return super().request(method, url, *args, **kwargs)


@pytest.fixture
def storage(tmp_path: Path) -> LocalStorage:
    """Attachments go to a temporary folder, never the development one."""
    return LocalStorage(tmp_path / "storage")


@pytest.fixture
def api(
    app: FastAPI,
    db_sessionmaker: sessionmaker[Session],
    outbox: OutboxMailer,
    storage: LocalStorage,
) -> Iterator[ApiClient]:
    def override_db() -> Iterator[Session]:
        with db_sessionmaker() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_mailer] = lambda: outbox
    app.dependency_overrides[get_storage] = lambda: storage
    with ApiClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def make_api(app: FastAPI, api: ApiClient) -> Iterator[Any]:
    """Creates additional independent clients (separate cookie jars) sharing the same app."""
    clients: list[ApiClient] = []

    def factory() -> ApiClient:
        new_client = ApiClient(app, raise_server_exceptions=False)
        new_client.__enter__()
        clients.append(new_client)
        return new_client

    yield factory
    for extra in clients:
        extra.__exit__(None, None, None)
