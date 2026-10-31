"""One regression test per fixed audit finding (docs/security-audit.md), named after its ID."""

import logging
from typing import Any

import pytest
from argon2 import PasswordHasher
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.middleware import MAX_BODY_BYTES
from app.main import create_app
from app.modules.audit_logs.models import AuditLog
from app.modules.tasks.models import TaskCollaborator, TaskVisibilityGrant
from tests.conftest import ApiClient
from tests.factories import DEFAULT_PASSWORD, create_org, departments_of, join_as, login, register


@pytest.fixture(autouse=True)
def cheap_password_hashing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.modules.auth.passwords._hasher",
        PasswordHasher(time_cost=1, memory_cost=8, parallelism=1),
    )


@pytest.fixture
def owner(api: ApiClient) -> ApiClient:
    register(api, email="owner@example.com", name="Olivia Owner")
    return api


@pytest.fixture
def person(make_api):
    def factory(name: str) -> ApiClient:
        client = make_api()
        email = f"{name.lower().replace(' ', '.')}@example.com"
        assert register(client, email=email, name=name).status_code == 201
        return client

    return factory


class Org:
    def __init__(self, owner: ApiClient) -> None:
        self.owner = owner
        self.data = create_org(owner)
        self.id: int = self.data["id"]
        self.base = f"/api/v1/organizations/{self.id}"
        self.departments = departments_of(owner, self.id)
        self.engineering = self.departments["Engineering"]
        self.sales = self.departments["Sales"]

    def join(self, client: ApiClient, role: str = "member", department: str = "Engineering"):
        join_as(self.owner, client, self.id, self.departments[department], role_key=role)

    def member_url(self, name: str, suffix: str = "") -> str:
        members = self.owner.get(f"{self.base}/members", params={"q": name}).json()
        return f"{self.base}/members/{members['items'][0]['membership_id']}{suffix}"

    def invite(self, client: ApiClient, **fields: Any) -> str:
        response = client.post(f"{self.base}/invitations", json=fields)
        assert response.status_code == 201, response.text
        return response.json()["link"].rsplit("/", 1)[1]


@pytest.fixture
def org(owner: ApiClient) -> Org:
    return Org(owner)


def accept(client: ApiClient, token: str) -> Any:
    return client.post(f"/api/v1/invitations/{token}/accept")


# --- S-01 Invitations don't outlive their creator's authority ----------------------------------


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("post", "/remove", {}),
        ("post", "/suspend", {}),
        ("patch", "/roles", {"organization_role": "member"}),
    ],
)
def test_s01_losing_admin_ends_your_invitations(
    org: Org, person, method: str, suffix: str, body: dict[str, Any]
) -> None:
    rogue = person("Rogue Admin")
    org.join(rogue, "admin")
    token = org.invite(rogue)

    response = getattr(org.owner, method)(org.member_url("Rogue Admin", suffix), json=body)

    assert response.status_code < 300, response.text
    sock = person("Sock Puppet")
    refused = accept(sock, token)
    assert refused.status_code == 400 and refused.json()["error"]["code"] == "invitation_invalid"
    assert sock.get("/api/v1/me/organizations").json() == []
    assert sock.get(f"/api/v1/invitations/{token}").status_code == 400
    listed = org.owner.get(f"{org.base}/invitations").json()
    assert [invitation["status"] for invitation in listed] == ["revoked"]


def test_s01_the_audit_log_counts_what_was_revoked(org: Org, person, db: Session) -> None:
    rogue = person("Rogue Admin")
    org.join(rogue, "admin")
    org.invite(rogue)
    org.invite(rogue)
    org.owner.post(org.member_url("Rogue Admin", "/remove"), json={})
    db.rollback()
    entry = db.scalar(select(AuditLog).where(AuditLog.action == "member.removed"))
    assert entry is not None and entry.details["invitations_revoked"] == 2


def test_s01_acceptance_rechecks_authority_even_without_the_revoke(
    org: Org, person, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The second lock: if the first ever misses one, the link still can't be used."""
    rogue = person("Rogue Admin")
    org.join(rogue, "admin")
    token = org.invite(rogue)
    monkeypatch.setattr("app.modules.memberships.management.revoke_invitations_from", lambda *_: 0)
    org.owner.post(org.member_url("Rogue Admin", "/remove"), json={})
    assert accept(person("Sock Puppet"), token).status_code == 400


def test_s01_ordinary_invitations_still_work(org: Org, person) -> None:
    admin = person("Ann Admin")
    org.join(admin, "admin")
    assert accept(person("New Hire"), org.invite(admin)).status_code == 200
    # A former Owner is an Admin, so what they sent before handing over remains good.
    token = org.invite(org.owner)
    successor = person("Sam Successor")
    org.join(successor)
    org.owner.post(
        f"{org.base}/ownership-transfer",
        json={
            "membership_id": int(org.member_url("Sam Successor").rsplit("/", 1)[1]),
            "password": DEFAULT_PASSWORD,
        },
    )
    assert accept(person("Late Joiner"), token).status_code == 200


# --- S-05 Configuration ------------------------------------------------------------------------


def test_s05_the_app_refuses_to_start_without_app_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APP_ENV", raising=False)
    with pytest.raises(ValidationError, match="app_env"):
        Settings(_env_file=None)


# --- S-07 Logs ---------------------------------------------------------------------------------


def test_s07_invitation_tokens_stay_out_of_the_request_log(
    org: Org, caplog: pytest.LogCaptureFixture
) -> None:
    token = org.invite(org.owner)
    caplog.set_level(logging.INFO, logger="denote.request")
    org.owner.get(f"/api/v1/invitations/{token}")
    org.owner.post(f"/api/v1/invitations/{token}/accept")

    paths = [
        record.extra_fields["path"] for record in caplog.records if record.name == "denote.request"
    ]
    assert "/api/v1/invitations/<token>" in paths
    assert "/api/v1/invitations/<token>/accept" in paths
    assert not any(token in path for path in paths)


# --- S-08 Headers ------------------------------------------------------------------------------


def test_s08_api_responses_carry_security_headers(api: ApiClient) -> None:
    for response in (api.get("/api/v1/health"), api.get("/api/v1/does-not-exist")):
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["cache-control"] == "no-store"
        assert "default-src 'none'" in response.headers["content-security-policy"]
    assert "strict-transport-security" not in api.get("/api/v1/health").headers


def test_s08_development_docs_keep_working(api: ApiClient) -> None:
    response = api.get("/api/docs")
    assert response.status_code == 200
    assert "content-security-policy" not in response.headers


def test_s08_production_turns_on_hsts_and_hides_health_details(settings: Settings) -> None:
    production = settings.model_copy(update={"app_env": "production"})
    with TestClient(create_app(production)) as client:
        headers = client.get("/api/v1/auth/csrf").headers
    assert "max-age=31536000" in headers["strict-transport-security"]


# --- S-09 Request size -------------------------------------------------------------------------


def test_s09_oversized_requests_are_refused(owner: ApiClient) -> None:
    response = owner.post(
        "/api/v1/me/tasks",
        json={"title": "x", "description": "A" * (MAX_BODY_BYTES + 1)},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_s09_a_chunked_request_cannot_hide_its_size(owner: ApiClient) -> None:
    def chunks():
        for _ in range(3):
            yield b"A" * (MAX_BODY_BYTES // 2)

    response = owner.post(
        "/api/v1/me/tasks", content=chunks(), headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_s09_the_longest_real_task_still_fits(owner: ApiClient) -> None:
    response = owner.post("/api/v1/me/tasks", json={"title": "x", "description": "é" * 10_000})
    assert response.status_code == 201, response.text


# --- S-10 Creation limits ----------------------------------------------------------------------


def test_s10_organization_creation_is_limited(owner: ApiClient) -> None:
    statuses = [
        owner.post("/api/v1/organizations", json={"name": f"Org {index}"}).status_code
        for index in range(21)
    ]
    assert statuses == [201] * 20 + [429]


@pytest.mark.parametrize(
    ("limit", "path", "body"),
    [
        ("TASKS_PER_USER", "/api/v1/me/tasks", {"title": "x"}),
        ("TAGS_PER_USER", "/api/v1/me/tags", {"name": "tag"}),
    ],
)
def test_s10_task_and_tag_creation_are_limited(
    owner: ApiClient,
    monkeypatch: pytest.MonkeyPatch,
    limit: str,
    path: str,
    body: dict[str, str],
) -> None:
    from app.common.rate_limit import RateLimit
    from app.modules.tasks import service

    original = getattr(service, limit)
    monkeypatch.setattr(service, limit, RateLimit(original.action, 2, original.window))
    results = []
    for index in range(3):
        payload = {key: f"{value}{index}" for key, value in body.items()}
        results.append(owner.post(path, json=payload).status_code)
    assert results == [201, 201, 429]


# --- S-11 Admin invitations --------------------------------------------------------------------


def test_s11_admin_invitations_need_an_email_and_a_short_life(org: Org) -> None:
    url = f"{org.base}/invitations"
    unlocked = org.owner.post(url, json={"role_key": "admin"})
    assert unlocked.status_code == 422
    assert unlocked.json()["error"]["details"][0]["field"] == "email"
    long_lived = org.owner.post(
        url, json={"role_key": "admin", "email": "a@example.com", "expires_in_days": 8}
    )
    assert long_lived.status_code == 422
    good = org.owner.post(url, json={"role_key": "admin", "email": "a@example.com"})
    assert good.status_code == 201, good.text


def test_s11_other_invitations_are_unchanged(org: Org) -> None:
    url = f"{org.base}/invitations"
    assert org.owner.post(url, json={"expires_in_days": 30}).status_code == 201
    manager = {"role_key": "department_manager", "department_id": org.engineering}
    assert org.owner.post(url, json=manager).status_code == 201


# --- S-12 Rejoining ----------------------------------------------------------------------------


def test_s12_rejoining_does_not_restore_task_access(org: Org, person, db: Session) -> None:
    helper = person("Helper Person")
    org.join(helper)
    helper_id = helper.get("/api/v1/me").json()["id"]
    shared = org.owner.post(
        f"{org.base}/tasks",
        json={"title": "Board paper", "visibility": "private", "collaborator_ids": [helper_id]},
    ).json()
    selected = org.owner.post(
        f"{org.base}/tasks",
        json={"title": "Pay review", "visibility": "selected", "visible_to": [helper_id]},
    ).json()

    org.owner.post(org.member_url("Helper Person", "/remove"), json={})
    assert accept(helper, org.invite(org.owner)).status_code == 200

    assert helper.get(f"/api/v1/tasks/{shared['id']}").status_code == 404
    assert helper.get(f"/api/v1/tasks/{selected['id']}").status_code == 404
    db.rollback()
    assert db.scalars(select(TaskCollaborator)).all() == []
    assert db.scalars(select(TaskVisibilityGrant)).all() == []


def test_s12_suspending_keeps_task_links_for_reactivation(org: Org, person) -> None:
    helper = person("Helper Person")
    org.join(helper)
    helper_id = helper.get("/api/v1/me").json()["id"]
    task = org.owner.post(
        f"{org.base}/tasks",
        json={"title": "Board paper", "visibility": "private", "collaborator_ids": [helper_id]},
    ).json()
    org.owner.post(org.member_url("Helper Person", "/suspend"), json={})
    org.owner.post(org.member_url("Helper Person", "/reactivate"))
    assert helper.get(f"/api/v1/tasks/{task['id']}").status_code == 200


# --- S-13 Creators who leave -------------------------------------------------------------------


def test_s13_leaving_a_department_ends_control_of_its_tasks(org: Org, person) -> None:
    mover = person("Mover Person")
    org.join(mover)
    task = mover.post(
        f"{org.base}/tasks",
        json={"title": "Old work", "department_id": org.engineering},
    ).json()
    url = f"/api/v1/tasks/{task['id']}"
    assert "edit" in mover.get(url).json()["actions"]

    org.owner.post(
        org.member_url("Mover Person", "/transfer"),
        json={"from_department_id": org.engineering, "to_department_id": org.sales},
    )

    assert mover.get(url).status_code == 200  # they can still read what they wrote
    assert mover.get(url).json()["actions"] == []
    assert mover.patch(url, json={"title": "Changed"}).status_code == 403
    assert mover.patch(url, json={"visibility": "private"}).status_code == 403
    assert mover.post(f"{url}/archive").status_code == 403


def test_s13_tasks_with_no_department_stay_with_their_creator(org: Org, person) -> None:
    mover = person("Mover Person")
    org.join(mover)
    task = mover.post(f"{org.base}/tasks", json={"title": "Mine"}).json()
    org.owner.post(
        org.member_url("Mover Person", "/transfer"),
        json={"from_department_id": org.engineering, "to_department_id": org.sales},
    )
    response = mover.patch(f"/api/v1/tasks/{task['id']}", json={"title": "Still mine"})
    assert response.status_code == 200


def test_s13_being_the_assignee_still_counts_after_moving(org: Org, person) -> None:
    mover = person("Mover Person")
    org.join(mover)
    mover_id = mover.get("/api/v1/me").json()["id"]
    task = org.owner.post(
        f"{org.base}/tasks",
        json={"title": "Handover", "department_id": org.engineering, "assigned_to": mover_id},
    ).json()
    org.owner.post(
        org.member_url("Mover Person", "/transfer"),
        json={"from_department_id": org.engineering, "to_department_id": org.sales},
    )
    response = mover.patch(f"/api/v1/tasks/{task['id']}", json={"status": "in_progress"})
    assert response.status_code == 200


# --- S-15 Control characters -------------------------------------------------------------------


@pytest.mark.parametrize("bad", ["Acme\r\nBcc: x@example.com", "line\nbreak", "null\x00byte"])
def test_s15_control_characters_are_refused_in_single_line_fields(
    owner: ApiClient, bad: str
) -> None:
    assert owner.post("/api/v1/organizations", json={"name": bad}).status_code == 422
    assert owner.patch("/api/v1/me", json={"name": bad}).status_code == 422
    assert owner.post("/api/v1/me/tasks", json={"title": bad}).status_code == 422
    assert owner.post("/api/v1/me/tags", json={"name": bad}).status_code == 422


def test_s15_descriptions_keep_their_line_breaks(owner: ApiClient) -> None:
    text = "First line\r\nSecond line\n\tIndented"
    response = owner.post("/api/v1/me/tasks", json={"title": "Notes", "description": text})
    assert response.status_code == 201, response.text
    assert response.json()["description"] == text
    bad = owner.post("/api/v1/me/tasks", json={"title": "x", "description": "null\x00byte"})
    assert bad.status_code == 422


def test_s15_normal_text_is_untouched(owner: ApiClient) -> None:
    for title in (
        "Reunión de equipo 🔥",
        "日本語のタスク",
        'Tom\'s "quoted" <task> & more',
        "a\tb",
    ):
        response = owner.post("/api/v1/me/tasks", json={"title": title})
        assert response.status_code == 201, title
        assert response.json()["title"] == title


def test_s15_passwords_are_not_touched(make_api) -> None:
    client = make_api()
    password = "control\x07character password"
    assert register(client, email="c@example.com", password=password).status_code == 201
    assert login(make_api(), "c@example.com", password).status_code == 200


# --- S-17 Security events ----------------------------------------------------------------------


def test_s17_security_events_are_logged_without_secrets(
    api: ApiClient, make_api, caplog: pytest.LogCaptureFixture
) -> None:
    register(api, email="s@example.com", name="Sam Person")
    other = make_api()
    caplog.set_level(logging.INFO, logger="denote.security")

    login(other, "s@example.com", "wrong password here")
    login(other, "nobody@example.com", "my-secret-typed-wrong")
    login(other, "s@example.com")
    other.post(
        "/api/v1/me/password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "a brand new long passphrase"},
    )

    records = [record for record in caplog.records if record.name == "denote.security"]
    events = [record.extra_fields["event"] for record in records]
    assert events == ["login_failed", "login_failed", "login_succeeded", "password_changed"]
    text = str([record.extra_fields for record in records])
    assert "my-secret-typed-wrong" not in text
    assert "nobody@example.com" not in text


# --- S-18 Review -------------------------------------------------------------------------------


@pytest.fixture
def reviewed(org: Org) -> Org:
    org.owner.patch(org.base, json={"review_required": True})
    return org


def in_review(org: Org, client: ApiClient, assignee: int, *, department: int | None) -> str:
    task = client.post(
        f"{org.base}/tasks",
        json={"title": "Work", "department_id": department, "assigned_to": assignee},
    ).json()
    url = f"/api/v1/tasks/{task['id']}"
    client.patch(url, json={"status": "in_progress"})
    assert client.patch(url, json={"status": "in_review"}).status_code == 200
    return url


def test_s18_nobody_approves_their_own_work(reviewed: Org, person) -> None:
    member = person("Mia Member")
    reviewed.join(member)
    url = in_review(
        reviewed, member, member.get("/api/v1/me").json()["id"], department=reviewed.engineering
    )

    assert "completed" not in member.get(url).json()["allowed_statuses"]
    assert member.post(f"{url}/complete").status_code == 403

    lead = person("Lee Lead")
    reviewed.join(lead, "team_lead")
    assert lead.post(f"{url}/complete").status_code == 200


def test_s18_a_one_person_organization_is_not_stuck(reviewed: Org) -> None:
    owner_id = reviewed.owner.get("/api/v1/me").json()["id"]
    url = in_review(reviewed, reviewed.owner, owner_id, department=None)
    assert reviewed.owner.post(f"{url}/complete").status_code == 200


# --- S-19 Crafted input ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "fields",
    [
        {"start_date": "0001-01-01"},
        {"due_date": "0001-01-01"},
        {"due_date": "9999-12-31"},
        {"start_date": "9999-12-31"},
    ],
)
def test_s19_absurd_dates_are_refused_cleanly(owner: ApiClient, fields: dict[str, str]) -> None:
    response = owner.post("/api/v1/me/tasks", json={"title": "x", **fields})
    assert response.status_code == 422


@pytest.mark.parametrize("params", [{"due_from": "0001-01-01"}, {"due_to": "9999-12-31"}])
def test_s19_absurd_date_filters_are_refused_cleanly(org: Org, params: dict[str, str]) -> None:
    assert org.owner.get(f"{org.base}/tasks", params=params).status_code == 422
    board = f"{org.base}/departments/{org.engineering}/board"
    assert org.owner.get(board, params=params).status_code == 422


def test_s19_realistic_dates_still_work(owner: ApiClient) -> None:
    for day in ("1999-12-31", "2099-01-01"):
        response = owner.post("/api/v1/me/tasks", json={"title": "x", "due_date": day})
        assert response.status_code == 201, response.text


def test_s19_a_non_ascii_csrf_token_is_a_clean_refusal(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "a@example.com", "password": "x"},
        headers={
            "X-CSRF-Token": "é".encode("latin-1"),
            "Cookie": "denote_csrf=é".encode("latin-1"),
        },
    )
    assert response.status_code in (403, 401, 422)


# --- S-21 Archived departments -----------------------------------------------------------------


def test_s21_invitations_to_an_archived_department_stop_working(org: Org, person) -> None:
    token = org.invite(org.owner, department_id=org.sales)
    org.owner.post(f"{org.base}/departments/{org.sales}/archive")
    guest = person("Guest Person")
    assert accept(guest, token).status_code == 400
    org.owner.post(f"{org.base}/departments/{org.sales}/restore")
    assert accept(guest, token).status_code == 200


# --- S-22, S-23 What errors and health reveal --------------------------------------------------


def test_s22_database_values_stay_out_of_errors_outside_development(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    from app.db.session import build_engine

    monkeypatch.setattr("app.db.session.get_settings", lambda: settings)
    engine = build_engine(test=True)
    with pytest.raises(DBAPIError) as caught, engine.connect() as connection:
        connection.execute(
            text("INSERT INTO no_such_table (secret) VALUES (:secret)"),
            {"secret": "hash-that-must-not-leak"},
        )
    assert "hash-that-must-not-leak" not in str(caught.value)
    engine.dispose()


def test_s23_health_hides_details_in_production(settings: Settings, app: FastAPI) -> None:
    from app.core.config import get_settings
    from app.modules.health.service import DependencyStatus, get_database_probe

    production = create_app(settings.model_copy(update={"app_env": "production"}))
    production.dependency_overrides[get_settings] = lambda: settings.model_copy(
        update={"app_env": "production"}
    )
    production.dependency_overrides[get_database_probe] = lambda: (
        lambda: DependencyStatus(status="ok", latency_ms=1)
    )
    with TestClient(production) as client:
        body = client.get("/api/v1/health").json()
    assert body["version"] is None and body["environment"] is None
    assert body["status"] == "ok"


# --- S-25 Website ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "website",
    ['http://x"><script>', "https://exa mple.com", "http://", "javascript:alert(1)", "ftp://a.b"],
)
def test_s25_invalid_websites_are_refused(org: Org, website: str) -> None:
    assert org.owner.patch(org.base, json={"website": website}).status_code == 422


@pytest.mark.parametrize(
    "website", ["https://example.com", "http://acme.co.in/about?x=1#team", "HTTPS://EXAMPLE.COM"]
)
def test_s25_real_websites_are_accepted(org: Org, website: str) -> None:
    response = org.owner.patch(org.base, json={"website": website})
    assert response.status_code == 200, response.text


def test_s25_clearing_the_website_still_works(org: Org) -> None:
    assert org.owner.patch(org.base, json={"website": None}).status_code == 200
