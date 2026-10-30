from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import Pool

from app.core.config import get_settings

SESSION_SQL_MODE = (
    "STRICT_TRANS_TABLES,ONLY_FULL_GROUP_BY,NO_ZERO_IN_DATE,NO_ZERO_DATE,"
    "ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION"
)


def build_engine(*, test: bool = False, poolclass: type[Pool] | None = None) -> Engine:
    settings = get_settings()
    engine = create_engine(
        settings.database_url(test=test),
        pool_pre_ping=True,
        pool_recycle=3600,
        connect_args={"connect_timeout": 5},
        poolclass=poolclass,
    )

    @event.listens_for(engine, "connect")
    def _configure_session(dbapi_connection, _record) -> None:  # type: ignore[no-untyped-def]
        # Don't trust server defaults (WAMP ships MyISAM and an empty sql_mode):
        # UTC so NOW() agrees with app-side values, strict mode so bad data errors instead of
        # being truncated, and InnoDB so foreign keys and transactions exist.
        with dbapi_connection.cursor() as cursor:
            cursor.execute(
                "SET time_zone = '+00:00', sql_mode = %s, default_storage_engine = 'InnoDB'",
                (SESSION_SQL_MODE,),
            )

    return engine


@lru_cache
def get_engine() -> Engine:
    return build_engine()


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """Request-scoped session. Services own commit boundaries; this only guarantees cleanup."""
    session = get_sessionmaker()()
    try:
        yield session
    finally:
        session.close()
