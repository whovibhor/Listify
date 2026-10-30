"""Measures report response times on 100,000 seeded tasks (NFR-02: p95 under 500 ms).

Usage (from backend/):  .venv\\Scripts\\python.exe -m scripts.perf_reports
Runs against the test database only, and empties it before and after. Refuses to run unless the
target database name ends with "_test".
"""

import random
import statistics
import sys
import time
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import insert, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.db.base import utc_now
from app.db.session import build_engine, get_db
from app.main import create_app
from app.modules.memberships.models import MembershipStatus, OrganizationMembership
from app.modules.tasks.models import Task, TaskPriority, TaskStatus, TaskVisibility, WorkspaceType
from app.modules.users.models import User
from scripts import reset_test_db
from tests.conftest import ApiClient
from tests.factories import create_org, departments_of, join_as, register

TASKS = 100_000
PEOPLE = 200
DEPARTMENTS = tuple(f"Team {number:02}" for number in range(10))
BATCH = 5_000
SAMPLES = 30
TARGET_MS = 500


def seed_tasks(
    db: Session, organization_id: int, department_ids: list[int], owner_id: int, people: list[int]
) -> None:
    now = utc_now()
    rows = []
    for index in range(TASKS):
        created = now - timedelta(minutes=random.randint(0, 400 * 24 * 60))
        department = random.choice(department_ids)
        finished = random.random() < 0.6
        due = None
        if random.random() < 0.7:
            due = created + timedelta(days=random.randint(1, 30))
        completed = None
        if finished:
            completed = min(now, created + timedelta(minutes=random.randint(10, 20_000)))
        status = (
            TaskStatus.COMPLETED
            if finished
            else random.choice([TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED])
        )
        rows.append(
            {
                "workspace_type": WorkspaceType.ORGANIZATION,
                "organization_id": organization_id,
                "department_id": department,
                "created_by": owner_id,
                "assigned_to": random.choice(people),
                "title": f"Seeded task {index}",
                "status": status,
                "priority": random.choice(list(TaskPriority)),
                "visibility": random.choice(
                    [TaskVisibility.DEPARTMENT] * 6
                    + [TaskVisibility.PRIVATE] * 3
                    + [TaskVisibility.ORGANIZATION]
                ),
                "due_at": due,
                "due_all_day": False,
                "sort_order": 0,
                "completed_at": completed,
                "completed_department_id": department if finished else None,
                "created_at": created,
                "updated_at": created,
            }
        )
        if len(rows) == BATCH:
            db.execute(insert(Task), rows)
            db.commit()
            rows = []
    if rows:
        db.execute(insert(Task), rows)
    db.commit()


def seed_people(db: Session, organization_id: int) -> list[int]:
    stamp = datetime(2026, 1, 1)
    users = [
        User(
            name=f"Seeded person {number}",
            email=f"seeded{number}@example.com",
            password_hash="x",
            timezone="UTC",
            terms_accepted_at=stamp,
            password_changed_at=stamp,
        )
        for number in range(PEOPLE)
    ]
    db.add_all(users)
    db.flush()
    db.add_all(
        OrganizationMembership(
            organization_id=organization_id,
            user_id=user.id,
            status=MembershipStatus.ACTIVE,
            joined_at=stamp,
        )
        for user in users
    )
    db.commit()
    return [user.id for user in users]


def measure(client: TestClient, url: str) -> tuple[float, float, float]:
    times = []
    for _ in range(SAMPLES):
        started = time.perf_counter()
        response = client.get(url)
        times.append((time.perf_counter() - started) * 1000)
        if response.status_code != 200:
            raise RuntimeError(f"{url}: {response.status_code} {response.text}")
    times.sort()
    return statistics.median(times), times[int(len(times) * 0.95) - 1], times[-1]


def main() -> int:
    target = get_settings().database_url(test=True).database or ""
    if not target.endswith("_test"):
        print(
            f"Refusing to run on '{target}': DB_TEST_NAME must end with '_test'.", file=sys.stderr
        )
        return 1
    if reset_test_db.main() != 0:
        return 1

    random.seed(7)
    engine = build_engine(test=True)
    sessions = sessionmaker(engine, expire_on_commit=False, autoflush=False)

    def override_db():
        with sessions() as session:
            yield session

    app = create_app()
    app.dependency_overrides[get_db] = override_db
    with ApiClient(app) as owner, ApiClient(app) as manager, sessions() as db:
        register(owner, email="owner@example.com", name="Olivia Owner")
        register(manager, email="manager@example.com", name="Max Manager")
        org = create_org(owner, "Load test", departments=DEPARTMENTS)
        departments = departments_of(owner, org["id"])
        department = departments[DEPARTMENTS[0]]
        join_as(owner, manager, org["id"], department, role_key="department_manager")
        people = seed_people(db, org["id"])
        print(f"Seeding {TASKS:,} tasks...", flush=True)
        owner_id = owner.get("/api/v1/me").json()["id"]
        seed_tasks(db, org["id"], list(departments.values()), owner_id, people)
        db.execute(text("ANALYZE TABLE tasks"))

        base = f"/api/v1/organizations/{org['id']}"
        today = utc_now().date()
        year = f"start={today - timedelta(days=365)}&end={today}"
        checks = [
            ("Organization, 30 days", owner, f"{base}/dashboard"),
            ("Organization, 1 year", owner, f"{base}/dashboard?{year}"),
            ("Departments list", owner, f"{base}/reports/departments"),
            ("Member activity", owner, f"{base}/reports/members"),
            ("Department, 30 days, Owner", owner, f"{base}/departments/{department}/dashboard"),
            (
                "Department, 1 year, Owner",
                owner,
                f"{base}/departments/{department}/dashboard?{year}",
            ),
            ("Department, 30 days, Manager", manager, f"{base}/departments/{department}/dashboard"),
            ("Member summary, Owner", owner, f"{base}/members/{people[0]}/summary"),
        ]
        print(f"{'Report':34}{'median':>9}{'p95':>9}{'slowest':>9}  ms over {SAMPLES} requests")
        over_target = 0
        for label, client, url in checks:
            median, p95, slowest = measure(client, url)
            flag = "" if p95 < TARGET_MS else "  OVER TARGET"
            over_target += p95 >= TARGET_MS
            print(f"{label:34}{median:9.0f}{p95:9.0f}{slowest:9.0f}{flag}")

    reset_test_db.main()
    return 1 if over_target else 0


if __name__ == "__main__":
    sys.exit(main())
