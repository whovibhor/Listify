"""What each busy page costs in SQL queries (ADR-031).

A page can return the right answer while running a query per row, which no other test notices
until it's slow in production. So the number of queries must stay the same as the data grows, and
stay under a ceiling that a change has to justify raising.
"""

from collections.abc import Callable, Iterator
from typing import Any

import pytest
from argon2 import PasswordHasher
from sqlalchemy import Engine, event

from tests.conftest import ApiClient
from tests.factories import create_task, register
from tests.test_organization_tasks import Team


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
def statements(test_engine: Engine) -> Iterator[list[str]]:
    seen: list[str] = []

    def record(_connection: Any, _cursor: Any, statement: str, *_rest: Any) -> None:
        seen.append(statement)

    event.listen(test_engine, "before_cursor_execute", record)
    yield seen
    event.remove(test_engine, "before_cursor_execute", record)


def cost(statements: list[str], request: Callable[[], Any]) -> int:
    statements.clear()
    response = request()
    assert response.status_code == 200, response.text
    return len(statements)


def add_tasks(team: Team, count: int) -> None:
    """Tasks with everything that has caused a query per row: subtasks, people and tags."""
    tag = team.owner.post(f"{team.base}/tags", json={"name": f"tag{count}"}).json()
    for number in range(count):
        task = team.eng_task(
            title=f"Task {count}-{number}",
            assigned_to=team.ids["Eve Eng"],
            tag_ids=[tag["id"]],
        )
        response = team.owner.post(
            f"{team.base}/tasks", json={"title": "Part of it", "parent_task_id": task["id"]}
        )
        assert response.status_code == 201, response.text
        response = team.owner.post(
            f"/api/v1/tasks/{task['id']}/collaborators", json={"user_id": team.ids["Ed Eng"]}
        )
        assert response.status_code == 200, response.text


@pytest.mark.parametrize(
    ("page", "ceiling"),
    [("board", 40), ("team tasks", 20), ("my work", 20)],
)
def test_task_pages_cost_the_same_however_many_tasks_there_are(
    team: Team, statements: list[str], page: str, ceiling: int
) -> None:
    urls = {
        "board": f"{team.base}/departments/{team.engineering}/board",
        "team tasks": f"{team.base}/tasks",
        "my work": f"{team.base}/tasks?view=my_work",
    }
    client = team.eng if page == "my work" else team.owner
    add_tasks(team, 2)
    few = cost(statements, lambda: client.get(urls[page]))

    add_tasks(team, 10)
    many = cost(statements, lambda: client.get(urls[page]))

    assert many == few, f"{page} went from {few} to {many} queries as tasks were added"
    assert many <= ceiling


def test_personal_tasks_cost_the_same_however_many_there_are(
    owner: ApiClient, statements: list[str]
) -> None:
    def add(count: int) -> None:
        for number in range(count):
            task = create_task(owner, f"Task {number}")
            create_task(owner, "Part of it", parent_task_id=task["id"])

    add(2)
    few = cost(statements, lambda: owner.get("/api/v1/me/tasks"))
    add(10)
    many = cost(statements, lambda: owner.get("/api/v1/me/tasks"))

    assert many == few
    assert many <= 8


def test_members_cost_the_same_however_many_people_there_are(
    team: Team, statements: list[str]
) -> None:
    few = cost(statements, lambda: team.owner.get(f"{team.base}/members"))
    for number in range(3):  # sign-ups are rate limited, and the team already used seven
        team.join(f"Extra Person{number}")
    many = cost(statements, lambda: team.owner.get(f"{team.base}/members"))

    assert many == few
    assert many <= 15


def test_task_detail_costs_the_same_however_many_subtasks_there_are(
    team: Team, statements: list[str]
) -> None:
    task = team.eng_task(title="Parent")

    def add(count: int) -> None:
        for number in range(count):
            team.owner.post(
                f"{team.base}/tasks", json={"title": f"Part {number}", "parent_task_id": task["id"]}
            )

    url = f"/api/v1/tasks/{task['id']}"
    add(2)
    few = cost(statements, lambda: team.owner.get(url))
    add(8)
    many = cost(statements, lambda: team.owner.get(url))

    assert many == few
    assert many <= 20


def test_inbox_costs_the_same_however_many_notifications_there_are(
    team: Team, statements: list[str]
) -> None:
    def assign(count: int) -> None:
        for number in range(count):
            team.eng_task(title=f"For Eve {number}", assigned_to=team.ids["Eve Eng"])

    assign(2)
    few = cost(statements, lambda: team.eng.get("/api/v1/inbox"))
    assign(8)
    many = cost(statements, lambda: team.eng.get("/api/v1/inbox"))

    assert many == few
    assert many <= 14  # includes 2 to find what's shared with a non-Owner, once per request

    scoped = cost(statements, lambda: team.eng.get("/api/v1/inbox", params={"workspace": team.id}))
    assert scoped <= many + 1  # the workspace check


def test_a_signed_in_request_stays_cheap(team: Team, statements: list[str]) -> None:
    assert cost(statements, lambda: team.owner.get("/api/v1/me")) <= 3
