"""Migrates the test database to head and empties every table (used before E2E runs).

Usage (from backend/):  .venv\\Scripts\\python.exe -m scripts.reset_test_db
Refuses to run unless the target database name ends with "_test".
"""

import sys
from argparse import Namespace

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.core.config import BACKEND_DIR, get_settings
from app.db.session import build_engine


def main() -> int:
    target = get_settings().database_url(test=True).database or ""
    if not target.endswith("_test"):
        print(f"Refusing to reset '{target}': DB_TEST_NAME must end with '_test'.", file=sys.stderr)
        return 1

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.cmd_opts = Namespace(x=["test=true"])
    command.upgrade(config, "head")

    engine = build_engine(test=True)
    with engine.begin() as connection:
        tables = connection.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = DATABASE() AND table_name <> 'alembic_version'"
            )
        ).scalars()
        connection.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
        for table in tables:
            connection.execute(text(f"TRUNCATE TABLE `{table}`"))
        connection.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
    engine.dispose()
    print(f"Reset test database '{target}'.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
