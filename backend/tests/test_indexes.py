"""Indexes only help if MySQL uses them, and a passing test can't tell when it stops (ADR-033)."""

from collections.abc import Iterator
from typing import Any

import pytest
from argon2 import PasswordHasher
from sqlalchemy import Engine, event, insert, text
from sqlalchemy.orm import Session

from app.modules.tasks.models import Task, TaskPriority, TaskStatus, WorkspaceType
from tests.conftest import ApiClient
from tests.factories import register
from tests.test_organization_tasks import Team

TASKS_FOR_THE_PLANNER = 3000


@pytest.fixture(autouse=True)
def cheap_password_hashing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.modules.auth.passwords._hasher",
        PasswordHasher(time_cost=1, memory_cost=8, parallelism=1),
    )


@pytest.fixture
def owner(api: ApiClient) -> ApiClient:
    register(api)
    return api


@pytest.fixture
def person(make_api):
    def create(name: str) -> ApiClient:
        client = make_api()
        email = name.lower().replace(" ", ".") + "@example.com"
        register(client, email=email, name=name)
        return client

    return create


@pytest.fixture
def team(owner: ApiClient, person) -> Team:
    return Team(owner, person)


@pytest.fixture
def rendered(test_engine: Engine) -> Iterator[list[str]]:
    """Statements exactly as MySQL receives them, values included."""
    seen: list[str] = []

    def record(
        _connection: Any,
        cursor: Any,
        statement: str,
        parameters: Any,
        _context: Any,
        executemany: bool,
    ) -> None:
        if not executemany:
            seen.append(cursor.mogrify(statement, parameters))

    event.listen(test_engine, "before_cursor_execute", record)
    yield seen
    event.remove(test_engine, "before_cursor_execute", record)


def add_tasks(db: Session, team: Team) -> None:
    owner_id = team.ids["Ada Lovelace"]
    db.execute(
        insert(Task),
        [
            {
                "workspace_type": WorkspaceType.ORGANIZATION,
                "organization_id": team.id,
                "department_id": team.engineering,
                "created_by": owner_id,
                "title": f"Task {number}",
                "status": TaskStatus.NOT_STARTED,
                "priority": list(TaskPriority)[number % 4],
                "due_all_day": False,
                "sort_order": 0,
            }
            for number in range(TASKS_FOR_THE_PLANNER)
        ],
    )
    db.commit()
    db.execute(text("ANALYZE TABLE tasks"))
    db.commit()


def plan_of(db: Session, statement: str) -> dict[str, Any]:
    escaped = statement.replace(":", r"\:")
    return dict(db.execute(text(f"EXPLAIN {escaped}")).mappings().first())


def test_the_default_task_sort_reads_its_index_instead_of_sorting(
    team: Team, db: Session, rendered: list[str]
) -> None:
    """MySQL only matches the index if it says exactly what `order_by("due")` says.

    A version differing by one `ELSE` was silently ignored, so this watches the real query.
    """
    add_tasks(db, team)
    rendered.clear()

    response = team.owner.get(f"{team.base}/tasks")

    assert response.status_code == 200, response.text
    rows = [sql for sql in rendered if "ORDER BY" in sql and sql.startswith("SELECT tasks.id, ")]
    plan = plan_of(db, rows[0])
    assert plan["key"] == "ix_tasks_org_default_sort"
    assert "filesort" not in (plan["Extra"] or "")


def test_reports_can_be_answered_from_their_indexes(team: Team, db: Session) -> None:
    """They rely on every column they read being in the index, so no task row is opened."""
    add_tasks(db, team)

    plan = plan_of(
        db,
        f"SELECT department_id, status, count(*), sum(due_at < NOW()) FROM tasks "  # noqa: S608
        f"FORCE INDEX (ix_tasks_report_open) WHERE organization_id = {team.id} "
        f"AND parent_task_id IS NULL AND archived_at IS NULL "
        f"AND status IN ('not_started', 'in_progress') GROUP BY department_id, status",
    )

    assert "Using index" in plan["Extra"]
