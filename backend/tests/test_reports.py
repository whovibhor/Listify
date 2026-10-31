"""Organization, department and member reports: the numbers, who may see them, and exports."""

import csv
import io
from datetime import datetime
from typing import Any

import pytest
from argon2 import PasswordHasher
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.common.time import utc_to_local, zone
from app.modules.audit_logs.models import AuditLog
from app.modules.dashboards import export
from app.modules.dashboards.export import safe_cell
from app.modules.tasks.models import Task
from tests.conftest import ApiClient
from tests.factories import create_org, create_task, departments_of, register
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
def team(owner: ApiClient, person, frozen_now: datetime) -> Team:
    return Team(owner, person)


def set_task(db: Session, task: dict[str, Any], **values: Any) -> None:
    row = db.get(Task, task["id"])
    assert row is not None
    for key, value in values.items():
        setattr(row, key, value)
    db.commit()


def complete(team: Team, task: dict[str, Any], db: Session, at: datetime) -> None:
    response = team.owner.post(f"/api/v1/tasks/{task['id']}/complete")
    assert response.status_code == 200, response.text
    set_task(db, task, completed_at=at)


def block(team: Team, task: dict[str, Any]) -> None:
    for status in ("in_progress", "blocked"):
        response = team.owner.patch(f"/api/v1/tasks/{task['id']}", json={"status": status})
        assert response.status_code == 200, response.text


def organization(team: Team, client: ApiClient | None = None, **params: Any) -> dict[str, Any]:
    response = (client or team.owner).get(f"{team.base}/dashboard", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def department(team: Team, client: ApiClient | None = None, **params: Any) -> dict[str, Any]:
    response = (client or team.owner).get(
        f"{team.base}/departments/{team.engineering}/dashboard", params=params
    )
    assert response.status_code == 200, response.text
    return response.json()


def row_for(rows: list[dict[str, Any]], name: str) -> dict[str, Any]:
    return next(row for row in rows if row["name"] == name)


def exported(response: Any) -> list[dict[str, str]]:
    assert response.status_code == 200, response.text
    return list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))


# --- Definitions ---------------------------------------------------------------------------------


def test_organization_metrics(team: Team, db: Session, frozen_now: datetime) -> None:
    team.eng_task(title="Open, no deadline")
    team.eng_task(title="Overdue", due_date="2026-10-20")
    blocked = team.eng_task(title="Blocked and overdue", due_date="2026-10-21")
    block(team, blocked)
    team.create(title="Not in a department")

    on_time = team.eng_task(title="On time", due_date="2026-10-29")
    late = team.eng_task(title="Late", due_date="2026-10-10")
    undated = team.eng_task(title="Undated")
    reopened = team.eng_task(title="Reopened")
    too_old = team.eng_task(title="Before the period")
    archived = team.eng_task(title="Archived but finished")
    for task, day in ((on_time, 28), (late, 27), (undated, 26), (reopened, 25), (archived, 24)):
        complete(team, task, db, datetime(2026, 10, day, 12, 0))
    complete(team, too_old, db, datetime(2026, 8, 1, 12, 0))
    team.owner.post(f"/api/v1/tasks/{reopened['id']}/reopen")
    team.owner.post(f"/api/v1/tasks/{archived['id']}/archive")

    cancelled = team.eng_task(title="Cancelled")
    team.owner.patch(f"/api/v1/tasks/{cancelled['id']}", json={"status": "cancelled"})
    archived_open = team.eng_task(title="Archived and open", due_date="2026-10-01")
    team.owner.post(f"/api/v1/tasks/{archived_open['id']}/archive")
    # A subtask never counts on its own.
    team.owner.post(
        f"{team.base}/tasks",
        json={"title": "Subtask", "parent_task_id": on_time["id"], "due_date": "2026-10-01"},
    )

    db.execute(update(Task).values(created_at=frozen_now))
    db.commit()

    body = organization(team, start="2026-10-01", end="2026-10-30")

    assert body["counts"] == {
        # Open, Overdue, Blocked, No department, Reopened.
        "open": 5,
        "overdue": 2,
        "blocked": 1,
        # On time, Late, Undated, Archived. Reopened and the older task don't count.
        "completed": 4,
        # All twelve top-level tasks, whatever became of them.
        "created": 12,
    }
    assert body["on_time"] == {"eligible": 2, "on_time": 1, "rate": 0.5}
    assert body["period"]["timezone"] == "Asia/Kolkata"
    assert set(body["definitions"]) >= {"open", "overdue", "blocked", "completed", "on_time"}
    engineering = row_for(body["departments"], "Engineering")
    assert engineering["open"] == 4
    assert engineering["completed"] == 4
    assert row_for(body["departments"], "No department")["open"] == 1


def test_a_rate_with_nothing_to_measure_is_empty_rather_than_zero(team: Team, db: Session) -> None:
    task = team.eng_task(title="Undated")
    complete(team, task, db, datetime(2026, 10, 28, 12, 0))
    assert organization(team)["on_time"] == {"eligible": 0, "on_time": 0, "rate": None}


def test_period_boundaries_use_the_organization_timezone(team: Team, db: Session) -> None:
    """18:29 UTC on the 27th is 23:59 on the 27th in Kolkata, and 18:30 is 00:00 on the 28th."""
    last_moment = team.eng_task(title="Last moment of the 27th")
    first_moment = team.eng_task(title="First moment of the 28th")
    complete(team, last_moment, db, datetime(2026, 10, 27, 18, 29, 59))
    complete(team, first_moment, db, datetime(2026, 10, 27, 18, 30, 0))

    assert organization(team, start="2026-10-28", end="2026-10-28")["counts"]["completed"] == 1
    assert organization(team, start="2026-10-27", end="2026-10-27")["counts"]["completed"] == 1

    trend = organization(team, start="2026-10-27", end="2026-10-28")["trend"]
    assert [(point["date"], point["completed"]) for point in trend] == [
        ("2026-10-27", 1),
        ("2026-10-28", 1),
    ]


@pytest.mark.parametrize(
    ("timezone", "expected_day"),
    [("Asia/Kathmandu", "2026-10-28"), ("America/St_Johns", "2026-10-27"), ("UTC", "2026-10-27")],
)
def test_trend_days_work_in_timezones_with_uneven_offsets(
    team: Team, db: Session, timezone: str, expected_day: str
) -> None:
    team.owner.patch(team.base, json={"timezone": timezone})
    task = team.eng_task(title="Late evening UTC")
    complete(team, task, db, datetime(2026, 10, 27, 18, 40))
    trend = organization(team, start="2026-10-20", end="2026-10-29")["trend"]
    assert [point["date"] for point in trend if point["completed"]] == [expected_day]


def test_trend_matches_a_direct_conversion_of_every_completion(team: Team, db: Session) -> None:
    moments = [
        datetime(2026, 10, 26, 18, 29),
        datetime(2026, 10, 26, 18, 30),
        datetime(2026, 10, 27, 0, 0),
        datetime(2026, 10, 27, 18, 29, 59, 999000),
        datetime(2026, 10, 28, 23, 59),
    ]
    for index, moment in enumerate(moments):
        complete(team, team.eng_task(title=f"Done {index}"), db, moment)
    tz = zone("Asia/Kolkata")
    expected: dict[str, int] = {}
    for moment in moments:
        day = str(utc_to_local(moment, tz).date())
        expected[day] = expected.get(day, 0) + 1

    trend = organization(team, start="2026-10-20", end="2026-10-29")["trend"]
    assert {p["date"]: p["completed"] for p in trend if p["completed"]} == expected


def test_a_day_with_a_clock_change_stays_one_day(team: Team, db: Session) -> None:
    """New York's 8 March 2026 has 23 hours, and its boundaries still fall on local midnight."""
    team.owner.patch(team.base, json={"timezone": "America/New_York"})
    task = team.eng_task(title="Clocks went forward")
    complete(team, task, db, datetime(2026, 3, 9, 3, 59))  # 23:59 EDT on the 8th
    trend = organization(team, start="2026-03-07", end="2026-03-08")["trend"]
    assert [(point["date"], point["completed"]) for point in trend] == [
        ("2026-03-07", 0),
        ("2026-03-08", 1),
    ]


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"start": "2026-10-20", "end": "2026-10-10"}, "start"),
        ({"end": "2026-10-31"}, "end"),
        ({"start": "2025-01-01", "end": "2026-10-29"}, "end"),
        ({"start": "1999-12-31", "end": "2000-01-01"}, "start"),
        ({"start": "0001-01-01", "end": "0001-12-31"}, "start"),
    ],
)
def test_impossible_periods_are_refused(team: Team, params: dict[str, str], field: str) -> None:
    response = team.owner.get(f"{team.base}/dashboard", params=params)
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == field


def test_a_full_year_is_allowed_and_today_is_the_default_end(team: Team) -> None:
    assert len(organization(team, start="2025-10-30", end="2026-10-30")["trend"]) == 366
    period = organization(team)["period"]
    assert (period["start"], period["end"]) == ("2026-10-01", "2026-10-30")


def test_malformed_dates_are_refused(team: Team) -> None:
    response = team.owner.get(f"{team.base}/dashboard", params={"start": "' OR 1=1 --"})
    assert response.status_code == 422


# --- Attribution ---------------------------------------------------------------------------------


def test_completed_department_snapshot(team: Team, db: Session) -> None:
    """Work finished in Engineering stays Engineering's after moving; open work moves with it."""
    done = team.eng_task(title="Finished, then moved")
    complete(team, done, db, datetime(2026, 10, 28, 12, 0))
    moved_open = team.eng_task(title="Moved while open")
    for task in (done, moved_open):
        response = team.owner.patch(
            f"/api/v1/tasks/{task['id']}", json={"department_id": team.sales_department}
        )
        assert response.status_code == 200, response.text

    rows = organization(team)["departments"]
    assert row_for(rows, "Engineering")["completed"] == 1
    assert row_for(rows, "Engineering")["open"] == 0
    assert row_for(rows, "Sales")["completed"] == 0
    assert row_for(rows, "Sales")["open"] == 1

    eng = department(team)
    assert eng["counts"]["completed"] == 1
    assert [task["title"] for task in eng["recent_completions"]] == ["Finished, then moved"]


def test_reopening_removes_a_completion_from_its_department(team: Team, db: Session) -> None:
    task = team.eng_task(title="Not really finished")
    complete(team, task, db, datetime(2026, 10, 28, 12, 0))
    assert department(team)["counts"]["completed"] == 1
    team.owner.post(f"/api/v1/tasks/{task['id']}/reopen")
    body = department(team)
    assert body["counts"]["completed"] == 0
    assert body["recent_completions"] == []


def test_archived_department_keeps_its_history(team: Team, db: Session) -> None:
    created = team.owner.post(f"{team.base}/departments", json={"name": "Closed"}).json()
    team.owner.post(f"{team.base}/departments/{created['id']}/archive")
    assert "Closed" not in [row["name"] for row in organization(team)["departments"]]


# --- Department report ---------------------------------------------------------------------------


def test_department_report_lists_the_work(team: Team, db: Session) -> None:
    eve = team.ids["Eve Eng"]
    team.eng_task(title="Eve's", assigned_to=eve)
    overdue = team.eng_task(title="Eve's late", assigned_to=eve, due_date="2026-10-05")
    blocked = team.eng_task(title="Stuck")
    block(team, blocked)
    finished = team.eng_task(title="Finished", assigned_to=team.ids["Ed Eng"])
    complete(team, finished, db, datetime(2026, 10, 28, 12, 0))
    team.create(title="Sales work", department_id=team.sales_department)

    body = department(team)

    assert body["counts"]["open"] == 3
    assert body["by_status"] == {
        "not_started": 2,
        "in_progress": 0,
        "blocked": 1,
        "in_review": 0,
    }
    assert [task["title"] for task in body["overdue_tasks"]] == ["Eve's late"]
    assert body["overdue_tasks"][0]["assignee"]["name"] == "Eve Eng"
    assert overdue["id"] == body["overdue_tasks"][0]["id"]
    assert [task["title"] for task in body["blocked_tasks"]] == ["Stuck"]
    people = {row["user"]["name"] if row["user"] else None: row for row in body["by_assignee"]}
    assert people["Eve Eng"]["open"] == 2
    assert people["Eve Eng"]["overdue"] == 1
    assert people["Ed Eng"]["completed"] == 1
    assert people[None]["open"] == 1
    assert list(people) == ["Ed Eng", "Eve Eng", None]  # by name, never by output


def test_someone_who_left_the_department_cant_be_opened_from_it(team: Team) -> None:
    eve = team.ids["Eve Eng"]
    team.eng_task(title="Left behind", assigned_to=eve)
    response = team.owner.post(
        f"{team.base}/members/{team.membership_ids['Eve Eng']}/transfer",
        json={"from_department_id": team.engineering, "to_department_id": team.sales_department},
    )
    assert response.status_code == 200, response.text
    row = next(row for row in department(team)["by_assignee"] if row["user"])
    assert row["user"]["name"] == "Eve Eng"
    assert row["in_department"] is False


# --- Who may see what ----------------------------------------------------------------------------


def clients(team: Team) -> dict[str, ApiClient]:
    return {
        "owner": team.owner,
        "admin": team.admin,
        "manager": team.manager,
        "lead": team.lead,
        "member": team.eng,
        "other department": team.sales,
    }


@pytest.mark.parametrize(
    ("who", "expected"),
    [
        ("owner", 200),
        ("admin", 200),
        ("manager", 403),
        ("lead", 403),
        ("member", 403),
        ("other department", 403),
    ],
)
def test_organization_report_access(team: Team, who: str, expected: int) -> None:
    client = clients(team)[who]
    for path in ("dashboard", "reports/members", "reports/tasks.csv"):
        assert client.get(f"{team.base}/{path}").status_code == expected


@pytest.mark.parametrize(
    ("who", "expected"),
    [
        ("owner", 200),
        ("admin", 200),
        ("manager", 200),
        ("lead", 200),
        ("member", 403),  # their own department, but no permission
        ("other department", 404),  # someone else's department looks like it doesn't exist
    ],
)
def test_department_report_access(team: Team, who: str, expected: int) -> None:
    client = clients(team)[who]
    base = team.base
    url = f"{base}/departments/{team.engineering}/dashboard"
    assert client.get(url).status_code == expected
    export_url = f"{base}/reports/tasks.csv"
    response = client.get(export_url, params={"department_id": team.engineering})
    assert response.status_code == expected


def test_reports_stay_inside_the_organization(team: Team, person) -> None:
    outsider = person("Olly Outsider")
    for path in (
        "dashboard",
        "reports/departments",
        "reports/members",
        "reports/tasks.csv",
        f"departments/{team.engineering}/dashboard",
        f"members/{team.ids['Eve Eng']}/summary",
    ):
        assert outsider.get(f"{team.base}/{path}").status_code == 404


def test_another_organizations_department_cant_be_reported_on(team: Team, person) -> None:
    other_owner = person("Pat Owner")
    other = create_org(other_owner, "Elsewhere")
    theirs = departments_of(other_owner, other["id"])["Engineering"]
    url = f"{team.base}/departments/{theirs}/dashboard"
    assert team.owner.get(url).status_code == 404
    export_url = f"{team.base}/reports/tasks.csv"
    response = team.owner.get(export_url, params={"department_id": theirs})
    assert response.status_code == 404


def test_department_list_shows_only_what_you_can_report_on(team: Team) -> None:
    def names(client: ApiClient) -> list[str]:
        response = client.get(f"{team.base}/reports/departments")
        assert response.status_code == 200, response.text
        return [row["name"] for row in response.json()]

    assert names(team.owner) == ["Engineering", "Sales"]
    assert names(team.manager) == ["Engineering"]
    assert team.eng.get(f"{team.base}/reports/departments").status_code == 403


def test_private_work_never_reaches_a_department_report(team: Team, db: Session) -> None:
    """A task the reader couldn't open isn't counted, listed or exported (BRD Rule 14)."""
    secret_title = "Layoff planning"
    private = team.eng_task(title=secret_title, visibility="private", due_date="2026-10-01")
    block(team, private)
    finished = team.eng_task(title="Secret bonus", visibility="private", due_date="2026-10-29")
    complete(team, finished, db, datetime(2026, 10, 28, 12, 0))
    team.eng_task(title="Public work")

    for client in (team.manager, team.lead):
        body = department(team, client)
        assert body["counts"]["open"] == 1
        assert body["counts"]["overdue"] == 0
        assert body["counts"]["blocked"] == 0
        assert body["counts"]["completed"] == 0
        assert body["on_time"]["eligible"] == 0
        assert body["by_status"]["blocked"] == 0
        assert body["overdue_tasks"] == []
        assert body["blocked_tasks"] == []
        assert body["recent_completions"] == []
        assert sum(point["completed"] for point in body["trend"]) == 0
        response = client.get(
            f"{team.base}/reports/tasks.csv", params={"department_id": team.engineering}
        )
        assert [row["Title"] for row in exported(response)] == ["Public work"]

    # The Owner sees everything, which is how we know the work above was really there.
    assert department(team)["counts"]["open"] == 2
    assert department(team)["counts"]["completed"] == 1


def test_a_task_that_left_a_department_isnt_shown_to_its_old_manager(
    team: Team, db: Session
) -> None:
    done = team.eng_task(title="Moved away", visibility="department")
    complete(team, done, db, datetime(2026, 10, 28, 12, 0))
    team.owner.patch(f"/api/v1/tasks/{done['id']}", json={"department_id": team.sales_department})

    assert department(team)["counts"]["completed"] == 1
    assert department(team, team.manager)["counts"]["completed"] == 0


# --- Member summary ------------------------------------------------------------------------------


def summary(team: Team, client: ApiClient, name: str, **params: Any) -> Any:
    return client.get(f"{team.base}/members/{team.ids[name]}/summary", params=params)


def test_member_summary_counts_and_distribution(team: Team, db: Session) -> None:
    eve = team.ids["Eve Eng"]
    team.eng_task(title="High", assigned_to=eve, priority="high")
    team.eng_task(title="Late", assigned_to=eve, due_date="2026-10-01")
    blocked = team.eng_task(title="Stuck", assigned_to=eve)
    block(team, blocked)
    done = team.eng_task(title="Done", assigned_to=eve)
    complete(team, done, db, datetime(2026, 10, 28, 12, 0))
    team.eng_task(title="Someone else's", assigned_to=team.ids["Ed Eng"])
    team.owner.post(
        f"/api/v1/tasks/{blocked['id']}/update-requests",
        json={"recipient_id": eve, "message": "Any news?"},
    )

    response = summary(team, team.eng, "Eve Eng")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["is_self"] is True
    assert body["member"]["name"] == "Eve Eng"
    assert [item["name"] for item in body["member"]["departments"]] == ["Engineering"]
    assert body["counts"] == {
        "assigned": 3,
        "overdue": 1,
        "blocked": 1,
        "completed": 1,
        "pending_update_requests": 1,
    }
    assert body["by_status"]["blocked"] == 1
    assert body["by_priority"]["high"] == 1
    assert body["by_department"] == [{"id": team.engineering, "name": "Engineering", "open": 3}]
    assert "on_time" not in body  # no per-person performance score (PRD §5.9)
    assert "not_a_score" in body["definitions"]


@pytest.mark.parametrize(
    ("who", "target", "expected"),
    [
        ("member", "Eve Eng", 200),  # yourself
        ("owner", "Eve Eng", 200),
        ("admin", "Sam Sales", 200),
        ("manager", "Eve Eng", 200),
        ("lead", "Eve Eng", 200),
        ("member", "Ed Eng", 403),  # a colleague you can see, but may not report on
        ("manager", "Sam Sales", 404),  # outside your departments
        ("other department", "Eve Eng", 404),
    ],
)
def test_member_summary_access(team: Team, who: str, target: str, expected: int) -> None:
    assert summary(team, clients(team)[who], target).status_code == expected


def test_a_manager_sees_only_what_they_can_see_of_someones_work(team: Team) -> None:
    eve = team.ids["Eve Eng"]
    private = team.eng_task(title="Private to Eve", assigned_to=eve, visibility="private")
    team.owner.post(
        f"/api/v1/tasks/{private['id']}/update-requests",
        json={"recipient_id": eve, "message": "Secret?"},
    )
    team.eng_task(title="Shared", assigned_to=eve)

    own = summary(team, team.eng, "Eve Eng").json()
    manager = summary(team, team.manager, "Eve Eng").json()

    assert own["counts"]["assigned"] == 2
    assert own["counts"]["pending_update_requests"] == 1
    assert manager["counts"]["assigned"] == 1
    assert manager["counts"]["pending_update_requests"] == 0


def test_personal_tasks_never_reach_a_member_summary(team: Team) -> None:
    create_task(team.eng, "My private errand", due_date="2026-10-01")
    body = summary(team, team.eng, "Eve Eng").json()
    assert body["counts"]["assigned"] == 0
    assert body["counts"]["overdue"] == 0


def test_a_removed_member_has_no_summary(team: Team) -> None:
    response = team.owner.post(
        f"{team.base}/members/{team.membership_ids['Eve Eng']}/remove", json={}
    )
    assert response.status_code in (200, 204), response.text
    assert summary(team, team.owner, "Eve Eng").status_code == 404


def test_member_activity_is_listed_by_name(team: Team, db: Session) -> None:
    eve = team.ids["Eve Eng"]
    team.eng_task(title="Late", assigned_to=eve, due_date="2026-10-01")
    done = team.eng_task(title="Done", assigned_to=eve)
    complete(team, done, db, datetime(2026, 10, 28, 12, 0))
    create_task(team.eng, "Personal", due_date="2026-10-01")

    body = team.owner.get(f"{team.base}/reports/members", params={"page_size": 3}).json()

    assert body["total"] == 7
    assert len(body["items"]) == 3
    everyone = team.owner.get(f"{team.base}/reports/members", params={"page_size": 100}).json()
    names = [row["name"] for row in everyone["items"]]
    assert names == sorted(names)
    eve_row = row_for(everyone["items"], "Eve Eng")
    assert (eve_row["open"], eve_row["overdue"], eve_row["completed"]) == (1, 1, 1)


# --- Export --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ('=HYPERLINK("http://evil")', '\'=HYPERLINK("http://evil")'),
        ("+1+1", "'+1+1"),
        ("-2+3", "'-2+3"),
        ("@SUM(A1)", "'@SUM(A1)"),
        ("\tleading tab", "'\tleading tab"),
        ("\rcarriage", "'\rcarriage"),
        ("  =spaces first", "'  =spaces first"),
        (chr(0xFF1D) + "fullwidth", "'" + chr(0xFF1D) + "fullwidth"),
        ("Normal title", "Normal title"),
        ("a=b", "a=b"),
        ("", ""),
    ],
)
def test_spreadsheet_formulas_are_neutralised(value: str, expected: str) -> None:
    assert safe_cell(value) == expected


def test_export_holds_the_reports_rows_as_safe_text(team: Team, db: Session) -> None:
    team.owner.patch(f"/api/v1/organizations/{team.id}", json={"timezone": "Asia/Kolkata"})
    formula = team.eng_task(title="=cmd|'/c calc'!A1", due_date="2026-11-05")
    finished = team.eng_task(
        title="Finished, with a comma", assigned_to=team.ids["Eve Eng"], due_date="2026-10-29"
    )
    complete(team, finished, db, datetime(2026, 10, 28, 12, 0))
    older = team.eng_task(title="Before the period")
    complete(team, older, db, datetime(2026, 8, 1, 12, 0))
    cancelled = team.eng_task(title="Cancelled")
    team.owner.patch(f"/api/v1/tasks/{cancelled['id']}", json={"status": "cancelled"})

    response = team.owner.get(f"{team.base}/reports/tasks.csv")
    rows = exported(response)

    assert response.headers["content-type"].startswith("text/csv")
    assert (
        (response.headers["content-disposition"])
        == 'attachment; filename="denote-tasks-2026-10-01-to-2026-10-30.csv"'
    )
    assert response.content.startswith(b"\xef\xbb\xbf")
    body = organization(team)
    assert len(rows) == body["counts"]["open"] + body["counts"]["completed"]
    by_id = {int(row["Task ID"]): row for row in rows}
    assert by_id[formula["id"]]["Title"] == "'=cmd|'/c calc'!A1"
    assert by_id[formula["id"]]["Deadline (Asia/Kolkata)"] == "2026-11-05"
    row = by_id[finished["id"]]
    assert row["Title"] == "Finished, with a comma"
    assert row["Assignee"] == "Eve Eng"
    assert row["Completed (Asia/Kolkata)"] == "2026-10-28 17:30"
    assert row["Completed in department"] == "Engineering"
    assert row["On time"] == "Yes"


def test_people_and_departments_are_neutralised_too(team: Team, person) -> None:
    created = team.owner.post(f"{team.base}/departments", json={"name": "=Sales"}).json()
    team.create(title="Odd department", department_id=created["id"])
    rows = exported(team.owner.get(f"{team.base}/reports/tasks.csv"))
    assert rows[0]["Department"] == "'=Sales"


def test_department_export_uses_the_department_scope(team: Team, db: Session) -> None:
    team.eng_task(title="Engineering")
    team.create(title="Sales", department_id=team.sales_department)
    response = team.owner.get(
        f"{team.base}/reports/tasks.csv", params={"department_id": team.engineering}
    )
    assert [row["Title"] for row in exported(response)] == ["Engineering"]


def test_exports_are_audited_without_the_data(team: Team, db: Session) -> None:
    team.eng_task(title="Confidential title")
    exported(team.owner.get(f"{team.base}/reports/tasks.csv"))
    entry = db.scalar(select(AuditLog).where(AuditLog.action == "report.exported"))
    assert entry is not None
    assert entry.organization_id == team.id
    assert entry.details["rows"] == 1
    assert "Confidential title" not in str(entry.details)


def test_exports_are_rate_limited(team: Team) -> None:
    for _ in range(export.EXPORTS_PER_USER.limit):
        assert team.owner.get(f"{team.base}/reports/tasks.csv").status_code == 200
    assert team.owner.get(f"{team.base}/reports/tasks.csv").status_code == 429


def test_an_oversized_export_is_refused_rather_than_cut_short(
    team: Team, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(export, "MAX_EXPORT_ROWS", 1)
    team.eng_task(title="One")
    team.eng_task(title="Two")
    response = team.owner.get(f"{team.base}/reports/tasks.csv")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "export_too_large"


def test_now_is_used_for_overdue_not_the_end_of_the_period(team: Team) -> None:
    """Overdue describes today, so looking at an earlier period doesn't change it."""
    team.eng_task(title="Late", due_date="2026-10-20")
    body = organization(team, start="2026-09-01", end="2026-09-30")
    assert body["counts"]["overdue"] == 1
    assert body["period"]["generated_at"] == "2026-10-29T20:00:00Z"


# --- Department summary ------------------------------------------------------------------------


def department_summary(team: Team, client: ApiClient, department_id: int | None = None):
    return client.get(f"{team.base}/departments/{department_id or team.engineering}/summary")


def test_a_member_reads_team_totals_and_nobody_elses_numbers(team: Team) -> None:
    team.eng_task(assigned_to=team.ids["Eve Eng"])
    blocked = team.eng_task(assigned_to=team.ids["Ed Eng"])
    block(team, blocked)

    response = department_summary(team, team.eng)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["counts"]["open"] == 2
    assert body["counts"]["blocked"] == 1
    assert set(body) == {"period", "department", "managers", "counts", "trend", "definitions"}
    assert "Ed Eng" not in response.text
    assert "Eve Eng" not in response.text


def test_the_summary_is_open_to_the_same_people_as_the_board(team: Team, person) -> None:
    assert department_summary(team, team.owner).status_code == 200
    assert department_summary(team, team.admin, team.sales_department).status_code == 200
    assert department_summary(team, team.manager).status_code == 200
    assert department_summary(team, team.sales).status_code == 404
    assert department_summary(team, team.eng, team.sales_department).status_code == 404
    assert department_summary(team, team.owner, 999_999).status_code == 404

    other_owner = person("Oscar Other")
    create_org(other_owner, "Other Org")
    assert department_summary(team, other_owner).status_code == 404


def test_summary_totals_agree_with_what_the_reader_can_see(team: Team) -> None:
    team.eng_task(title="Shared with the department")
    team.eng_task(title="Between two people", visibility="private", assigned_to=team.ids["Ed Eng"])

    def open_for(client: ApiClient) -> int:
        return department_summary(team, client).json()["counts"]["open"]

    assert open_for(team.owner) == 2
    assert open_for(team.eng2) == 2
    assert open_for(team.eng) == 1
    assert len(team.board_titles(team.eng)) == 1


def test_summary_names_active_managers_and_counts_active_members(team: Team) -> None:
    body = department_summary(team, team.eng).json()
    assert [manager["name"] for manager in body["managers"]] == ["Max Manager"]
    assert body["department"]["member_count"] == 5

    member = f"{team.base}/members/{team.membership_ids['Max Manager']}"
    team.owner.post(f"{member}/suspend", json={})

    body = department_summary(team, team.eng).json()
    assert body["managers"] == []
    assert body["department"]["member_count"] == 4


def test_an_archived_department_keeps_its_summary(team: Team) -> None:
    team.owner.post(f"{team.base}/departments/{team.engineering}/archive")

    response = department_summary(team, team.eng)

    assert response.status_code == 200
    assert response.json()["department"]["status"] == "archived"
