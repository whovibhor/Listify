from datetime import datetime

from sqlalchemy.orm import Session

from app.modules.tasks.models import Task
from tests.conftest import ApiClient
from tests.factories import create_task, register


def _set(db: Session, task_id: int, **values) -> None:
    task = db.get(Task, task_id)
    assert task is not None
    for key, value in values.items():
        setattr(task, key, value)
    db.commit()


def test_personal_dashboard_metrics(api: ApiClient, make_api, db: Session, frozen_now: datetime):
    register(api)  # Asia/Kolkata; local "today" is 30 Oct, now = 29 Oct 20:00 UTC
    create_task(api, "Overdue", due_date="2026-10-29", priority="high")
    create_task(api, "Due today", due_date="2026-10-30", priority="urgent")
    create_task(api, "Next week", due_date="2026-11-05")
    create_task(api, "Someday")

    on_time = create_task(api, "On time", due_date="2026-10-29")
    late = create_task(api, "Late", due_date="2026-10-20")
    undated = create_task(api, "No deadline")
    reopened = create_task(api, "Reopened")
    archived_done = create_task(api, "Archived but done")
    for task in (on_time, late, undated, reopened, archived_done):
        api.post(f"/api/v1/tasks/{task['id']}/complete")
    api.post(f"/api/v1/tasks/{reopened['id']}/reopen")
    api.post(f"/api/v1/tasks/{archived_done['id']}/archive")

    # Completions at chosen instants; 19:00 UTC on the 29th is 00:30 on the 30th in Kolkata.
    _set(db, on_time["id"], completed_at=datetime(2026, 10, 29, 12, 0))
    _set(db, late["id"], completed_at=datetime(2026, 10, 29, 19, 0))
    _set(db, undated["id"], completed_at=datetime(2026, 10, 25, 6, 0))
    _set(db, archived_done["id"], completed_at=datetime(2026, 10, 1, 6, 0))  # outside 7d

    # A subtask and another user's task must never be counted.
    parent = create_task(api, "Parent")
    create_task(api, "Subtask", parent_task_id=parent["id"], due_date="2026-10-29")
    other = make_api()
    register(other, email="eve@example.com", name="Eve")
    create_task(other, "Eve overdue", due_date="2026-10-01")

    body = api.get("/api/v1/me/dashboard", params={"period": "7d"}).json()

    assert body["timezone"] == "Asia/Kolkata"
    assert body["period_start"] == "2026-10-23T18:30:00Z"  # 24 Oct 00:00 local
    counts = body["counts"]
    # Open: Overdue, Due today, Next week, Someday, Reopened, Parent.
    assert counts["open"] == 6
    assert counts["overdue"] == 1
    assert counts["due_today"] == 1
    assert counts["upcoming_7d"] == 1
    assert counts["completed_in_period"] == 3  # on time, late, undated (not reopened/old)
    assert body["on_time"] == {"eligible": 2, "on_time": 1, "rate": 0.5}

    trend = {point["date"]: point["completed"] for point in body["trend"]}
    assert len(trend) == 7 and min(trend) == "2026-10-24" and max(trend) == "2026-10-30"
    assert trend["2026-10-29"] == 1  # 12:00 UTC → 17:30 local on the 29th
    assert trend["2026-10-30"] == 1  # 19:00 UTC → 00:30 local on the 30th
    assert trend["2026-10-25"] == 1

    assert body["open_by_priority"]["urgent"] == 1
    assert body["open_by_priority"]["high"] == 1
    assert body["open_by_status"]["in_progress"] == 1  # the reopened task
    assert "deadline" in body["definitions"]["overdue"]


def test_dashboard_on_time_rate_is_null_without_eligible_tasks(
    api: ApiClient, frozen_now: datetime
) -> None:
    register(api)
    body = api.get("/api/v1/me/dashboard").json()
    assert body["on_time"] == {"eligible": 0, "on_time": 0, "rate": None}
    assert body["counts"]["open"] == 0


def test_dashboard_period_is_validated(api: ApiClient) -> None:
    register(api)
    assert api.get("/api/v1/me/dashboard", params={"period": "1y"}).status_code == 422
