from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.tasks.models import Task, TaskActivity
from tests.conftest import ApiClient
from tests.factories import create_tag, create_task, list_tasks, register, titles


@pytest.fixture
def ada(api: ApiClient) -> ApiClient:
    register(api)
    return api


@pytest.fixture
def mallory(make_api) -> ApiClient:
    client = make_api()
    register(client, email="mallory@example.com", name="Mallory", timezone="UTC")
    return client


# --- Create & validate -----------------------------------------------------------------------


def test_create_task_with_defaults_and_history(ada: ApiClient, db: Session) -> None:
    task = create_task(ada, "  Buy milk  ")

    assert task["title"] == "Buy milk"
    assert task["status"] == "not_started"
    assert task["priority"] == "medium"
    assert task["due_at"] is None and task["is_overdue"] is False
    assert task["subtasks"] == [] and task["tags"] == []
    events = db.scalars(select(TaskActivity.event_type).where(TaskActivity.task_id == task["id"]))
    assert list(events) == ["created"]


def test_deadlines_are_converted_from_the_users_timezone(ada: ApiClient) -> None:
    all_day = create_task(ada, "All day", due_date="2026-10-30")
    timed = create_task(
        ada, "Timed", due_date="2026-10-30", due_time="09:00", start_date="2026-10-28"
    )

    # Kolkata is UTC+05:30.
    assert all_day["due_at"] == "2026-10-30T18:29:59.999999Z" and all_day["due_all_day"] is True
    assert timed["due_at"] == "2026-10-30T03:30:00Z" and timed["due_all_day"] is False
    assert timed["start_at"] == "2026-10-27T18:30:00Z"


@pytest.mark.parametrize(
    "payload",
    [
        {"title": ""},
        {"title": "x" * 201},
        {"title": "t", "due_time": "10:00"},
        {"title": "t", "start_date": "2026-11-02", "due_date": "2026-11-01"},
        {"title": "t", "status": "completed"},
        {"title": "t", "priority": "critical"},
        {"title": "t", "owner_user_id": 999},
        {"title": "t", "tag_ids": [1, 1]},
        {"title": "t", "description": "x" * 10_001},
    ],
)
def test_create_rejects_invalid_input(ada: ApiClient, payload: dict) -> None:
    assert ada.post("/api/v1/me/tasks", json=payload).status_code == 422


def test_unknown_tag_is_rejected(ada: ApiClient) -> None:
    response = ada.post("/api/v1/me/tasks", json={"title": "t", "tag_ids": [424242]})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "tag_ids"


# --- Isolation (BR-002, NFR-01) ---------------------------------------------------------------


def test_personal_tasks_are_invisible_to_other_users(ada: ApiClient, mallory: ApiClient) -> None:
    task = create_task(ada, "Private diary")
    tag = create_tag(ada, "secret")
    tid = task["id"]

    assert mallory.get(f"/api/v1/tasks/{tid}").status_code == 404
    assert mallory.patch(f"/api/v1/tasks/{tid}", json={"title": "pwned"}).status_code == 404
    assert mallory.post(f"/api/v1/tasks/{tid}/complete").status_code == 404
    assert mallory.post(f"/api/v1/tasks/{tid}/archive").status_code == 404
    assert mallory.get(f"/api/v1/tasks/{tid}/activity").status_code == 404
    assert mallory.delete(f"/api/v1/tasks/{tid}").status_code == 404
    assert (
        mallory.post("/api/v1/me/tasks", json={"title": "x", "parent_task_id": tid}).status_code
        == 404
    )
    assert (
        mallory.post("/api/v1/me/tasks", json={"title": "x", "tag_ids": [tag["id"]]}).status_code
        == 422
    )
    assert list_tasks(mallory)["total"] == 0
    assert list_tasks(mallory, view="archived")["total"] == 0

    # Ada's task is untouched.
    assert ada.get(f"/api/v1/tasks/{tid}").json()["title"] == "Private diary"


def test_tasks_require_authentication(api: ApiClient) -> None:
    assert api.get("/api/v1/me/tasks").status_code == 401
    assert api.post("/api/v1/me/tasks", json={"title": "x"}).status_code == 401


# --- Update & history ------------------------------------------------------------------------


def test_update_fields_and_record_changes(ada: ApiClient) -> None:
    tag = create_tag(ada, "home", "green")
    task = create_task(ada, "Draft")

    response = ada.patch(
        f"/api/v1/tasks/{task['id']}",
        json={
            "title": "Final draft",
            "priority": "urgent",
            "description": "Notes",
            "due_date": "2026-11-05",
            "due_time": None,
            "tag_ids": [tag["id"]],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Final draft" and body["priority"] == "urgent"
    assert [t["name"] for t in body["tags"]] == ["home"]
    activity = ada.get(f"/api/v1/tasks/{task['id']}/activity").json()
    updated = next(a for a in activity if a["event_type"] == "updated")
    assert updated["old_value"]["title"] == "Draft"
    assert updated["new_value"]["title"] == "Final draft"
    assert updated["new_value"]["tags"] == ["home"]
    assert updated["actor_name"] == "Ada Lovelace"


def test_clearing_a_deadline_and_null_rules(ada: ApiClient) -> None:
    task = create_task(ada, "Has deadline", due_date="2026-11-05")
    tid = task["id"]

    assert ada.patch(f"/api/v1/tasks/{tid}", json={"due_date": None}).json()["due_at"] is None
    assert ada.patch(f"/api/v1/tasks/{tid}", json={"title": None}).status_code == 422
    assert ada.patch(f"/api/v1/tasks/{tid}", json={"due_time": "10:00"}).status_code == 422


# --- Status transitions ----------------------------------------------------------------------


def test_complete_reopen_cancel_restore(ada: ApiClient, frozen_now: datetime) -> None:
    tid = create_task(ada, "Ship it")["id"]

    done = ada.post(f"/api/v1/tasks/{tid}/complete").json()
    assert done["status"] == "completed"
    assert done["completed_at"] == "2026-10-29T20:00:00Z"

    invalid = ada.patch(f"/api/v1/tasks/{tid}", json={"status": "blocked"})
    assert invalid.status_code == 409
    assert invalid.json()["error"]["code"] == "invalid_transition"

    reopened = ada.post(f"/api/v1/tasks/{tid}/reopen").json()
    assert reopened["status"] == "in_progress" and reopened["completed_at"] is None

    assert ada.patch(f"/api/v1/tasks/{tid}", json={"status": "cancelled"}).status_code == 200
    assert ada.patch(f"/api/v1/tasks/{tid}", json={"status": "completed"}).status_code == 409
    assert (
        ada.patch(f"/api/v1/tasks/{tid}", json={"status": "not_started"}).json()["status"]
        == "not_started"
    )

    events = [a["event_type"] for a in ada.get(f"/api/v1/tasks/{tid}/activity").json()]
    assert events[::-1] == ["created", "completed", "reopened", "status_changed", "status_changed"]


def test_reopen_requires_completed(ada: ApiClient) -> None:
    tid = create_task(ada)["id"]
    assert ada.post(f"/api/v1/tasks/{tid}/reopen").status_code == 409


# --- Subtasks --------------------------------------------------------------------------------


def test_subtasks_block_parent_completion_until_done(ada: ApiClient) -> None:
    parent = create_task(ada, "Plan trip")
    first = create_task(ada, "Book flights", parent_task_id=parent["id"])
    second = create_task(ada, "Book hotel", parent_task_id=parent["id"])

    detail = ada.get(f"/api/v1/tasks/{parent['id']}").json()
    assert [s["title"] for s in detail["subtasks"]] == ["Book flights", "Book hotel"]
    assert detail["subtask_count"] == 2 and detail["subtasks_completed"] == 0

    blocked = ada.post(f"/api/v1/tasks/{parent['id']}/complete")
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "open_subtasks"

    ada.post(f"/api/v1/tasks/{first['id']}/complete")
    ada.patch(f"/api/v1/tasks/{second['id']}", json={"status": "cancelled"})
    assert ada.post(f"/api/v1/tasks/{parent['id']}/complete").status_code == 200
    assert ada.get(f"/api/v1/tasks/{parent['id']}").json()["subtasks_completed"] == 1


def test_subtasks_are_one_level_and_hidden_from_lists(ada: ApiClient) -> None:
    parent = create_task(ada, "Parent")
    child = create_task(ada, "Child", parent_task_id=parent["id"])

    nested = ada.post(
        "/api/v1/me/tasks", json={"title": "Grandchild", "parent_task_id": child["id"]}
    )
    assert nested.status_code == 422
    assert titles(list_tasks(ada)) == ["Parent"]


def test_deleting_a_parent_removes_subtasks(ada: ApiClient, db: Session) -> None:
    parent = create_task(ada, "Parent")
    child = create_task(ada, "Child", parent_task_id=parent["id"])

    assert ada.delete(f"/api/v1/tasks/{parent['id']}").status_code == 204
    assert ada.get(f"/api/v1/tasks/{parent['id']}").status_code == 404
    assert db.get(Task, child["id"]) is None


# --- Archive ---------------------------------------------------------------------------------


def test_archive_hides_task_makes_it_read_only_and_restore_brings_it_back(ada: ApiClient) -> None:
    tid = create_task(ada, "Old idea")["id"]

    archived = ada.post(f"/api/v1/tasks/{tid}/archive").json()
    assert archived["archived_at"] is not None
    assert titles(list_tasks(ada)) == []
    assert titles(list_tasks(ada, view="archived")) == ["Old idea"]
    edit = ada.patch(f"/api/v1/tasks/{tid}", json={"title": "x"})
    assert edit.status_code == 409 and edit.json()["error"]["code"] == "task_archived"

    ada.post(f"/api/v1/tasks/{tid}/restore")
    assert titles(list_tasks(ada)) == ["Old idea"]


# --- Views, filters, sorting -----------------------------------------------------------------


def test_views_use_the_users_local_day(ada: ApiClient, frozen_now: datetime) -> None:
    # Ada's "today" is 30 Oct (Kolkata) even though it is still 29 Oct in UTC.
    create_task(ada, "Overdue", due_date="2026-10-29")
    create_task(ada, "Due today", due_date="2026-10-30")
    create_task(ada, "Started", start_date="2026-10-30")
    create_task(ada, "Tomorrow", due_date="2026-10-31")
    create_task(ada, "In two weeks", due_date="2026-11-13")
    create_task(ada, "Too far", due_date="2026-11-14")
    create_task(ada, "No date")
    done = create_task(ada, "Finished", due_date="2026-10-30")
    ada.post(f"/api/v1/tasks/{done['id']}/complete")

    assert sorted(titles(list_tasks(ada, view="my_day"))) == ["Due today", "Overdue", "Started"]
    assert titles(list_tasks(ada, view="upcoming")) == ["Tomorrow", "In two weeks"]
    assert titles(list_tasks(ada, view="completed")) == ["Finished"]
    assert list_tasks(ada, view="all")["total"] == 7

    overdue = list_tasks(ada, overdue="true")
    assert titles(overdue) == ["Overdue"]
    assert overdue["items"][0]["is_overdue"] is True


def test_filters_search_sort_and_pagination(ada: ApiClient) -> None:
    work = create_tag(ada, "work")
    create_task(ada, "Low thing", priority="low")
    create_task(ada, "Urgent 100% thing", priority="urgent", tag_ids=[work["id"]])
    create_task(ada, "High thing", priority="high", status="in_progress")

    assert titles(list_tasks(ada, sort="priority")) == [
        "Urgent 100% thing",
        "High thing",
        "Low thing",
    ]
    assert titles(list_tasks(ada, priority=["low", "high"], sort="title")) == [
        "High thing",
        "Low thing",
    ]
    assert titles(list_tasks(ada, status="in_progress")) == ["High thing"]
    assert titles(list_tasks(ada, tag=work["id"])) == ["Urgent 100% thing"]
    assert titles(list_tasks(ada, q="100%")) == ["Urgent 100% thing"]
    assert list_tasks(ada, q="%")["total"] == 1  # % is literal, not a wildcard

    page = list_tasks(ada, page=2, page_size=2, sort="title")
    assert page["total"] == 3 and titles(page) == ["Urgent 100% thing"]
    assert ada.get("/api/v1/me/tasks", params={"page_size": 101}).status_code == 422
    assert ada.get("/api/v1/me/tasks", params={"view": "everything"}).status_code == 422


def test_done_today_view_uses_the_local_day(ada: ApiClient, db: Session, frozen_now: datetime):
    today = create_task(ada, "Finished today")
    yesterday = create_task(ada, "Finished yesterday")
    ada.post(f"/api/v1/tasks/{today['id']}/complete")
    ada.post(f"/api/v1/tasks/{yesterday['id']}/complete")
    # 18:00 UTC on the 29th is 23:30 local on the 29th: yesterday for this Kolkata user.
    task = db.get(Task, yesterday["id"])
    assert task is not None
    task.completed_at = datetime(2026, 10, 29, 18, 0)
    db.commit()

    assert titles(list_tasks(ada, view="done_today")) == ["Finished today"]
