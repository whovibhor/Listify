from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool

from app.core.config import get_settings
from app.db import models as _models  # noqa: F401  (registers every model on Base.metadata)
from app.db.base import Base
from app.db.session import build_engine

config = context.config
if config.config_file_name is not None:
    # Keep application loggers alive when migrations run in-process (tests).
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata

# `alembic -x test=true upgrade head` targets DB_TEST_NAME instead of DB_NAME.
use_test_db = context.get_x_argument(as_dictionary=True).get("test", "").lower() == "true"


def run_migrations_offline() -> None:
    url = get_settings().database_url(test=use_test_db)
    context.configure(
        url=url.render_as_string(hide_password=True),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def include_name(name: str | None, type_: str, _parent_names: dict) -> bool:
    # Built on expressions, which autogenerate can't compare. Only migrations manage it.
    return not (type_ == "index" and name == "ix_tasks_org_default_sort")


def run_migrations_online() -> None:
    engine = build_engine(test=use_test_db, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_name=include_name,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
