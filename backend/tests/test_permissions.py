"""Every role against every permission-guarded endpoint that exists so far (ADR-011).

Each case runs against the real API, so a route that forgot its check fails here. Who can see which
task is covered by the visibility matrix in `test_organization_tasks.py`.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pytest
from argon2 import PasswordHasher
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.permissions import catalog
from app.modules.permissions.models import Permission, Role
from tests.conftest import ApiClient
from tests.factories import (
    DEFAULT_PASSWORD,
    create_org,
    departments_of,
    join_as,
    register,
    request_to_join,
)

ROLE_KEYS = ("owner", "admin", "department_manager", "team_lead", "member")
ADMINS = {"owner", "admin"}
OWNER_ONLY = {"owner"}
MANAGERS = ADMINS | {"department_manager"}
LEADS = MANAGERS | {"team_lead"}


@dataclass
class World:
    """One organization with a person in every role, all in Engineering (Sales is the other)."""

    org_id: int
    engineering: int
    sales: int
    clients: dict[str, ApiClient]
    subject: int  # the membership of an ordinary Engineering member, to act on
    subject_user: int
    task: int  # created by the Owner, in Engineering, so nobody else is on it
    tag: int
    engineering_request: int
    sales_request: int

    @property
    def base(self) -> str:
        return f"/api/v1/organizations/{self.org_id}"

    @property
    def member_url(self) -> str:
        return f"{self.base}/members/{self.subject}"

    @property
    def task_url(self) -> str:
        return f"/api/v1/tasks/{self.task}"


@pytest.fixture(autouse=True)
def cheap_password_hashing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each case signs up nine people; real Argon2 costs would make this file take minutes."""
    monkeypatch.setattr(
        "app.modules.auth.passwords._hasher",
        PasswordHasher(time_cost=1, memory_cost=8, parallelism=1),
    )


@pytest.fixture
def world(api: ApiClient, make_api) -> World:
    def person(name: str) -> ApiClient:
        client = make_api()
        email = f"{name.lower().replace(' ', '.')}@example.com"
        assert register(client, email=email, name=name).status_code == 201
        return client

    register(api, email="owner@example.com", name="Olivia Owner")
    org = create_org(api)
    departments = departments_of(api, org["id"])
    engineering, sales = departments["Engineering"], departments["Sales"]

    clients = {"owner": api}
    for role_key in ROLE_KEYS[1:]:
        clients[role_key] = person(role_key.replace("_", " ").title())
        join_as(api, clients[role_key], org["id"], engineering, role_key=role_key)
    join_as(api, person("Sam Subject"), org["id"], engineering)

    members = api.get(
        f"/api/v1/organizations/{org['id']}/members", params={"q": "Sam Subject"}
    ).json()
    task = api.post(
        f"/api/v1/organizations/{org['id']}/tasks",
        json={"title": "Team task", "department_id": engineering},
    ).json()
    tag = api.post(f"/api/v1/organizations/{org['id']}/tags", json={"name": "team"}).json()
    return World(
        org_id=org["id"],
        engineering=engineering,
        sales=sales,
        clients=clients,
        subject=members["items"][0]["membership_id"],
        subject_user=members["items"][0]["user_id"],
        task=task["id"],
        tag=tag["id"],
        engineering_request=request_to_join(person("Amy Eng"), org["id"], engineering).json()["id"],
        sales_request=request_to_join(person("Ben Sales"), org["id"], sales).json()["id"],
    )


Attempt = Callable[[World, ApiClient], Any]

CASES: dict[str, tuple[Attempt, set[str]]] = {
    "read organization": (lambda w, c: c.get(w.base), set(ROLE_KEYS)),
    "list members": (lambda w, c: c.get(f"{w.base}/members"), set(ROLE_KEYS)),
    "update settings": (lambda w, c: c.patch(w.base, json={"description": "New"}), ADMINS),
    "read audit log": (lambda w, c: c.get(f"{w.base}/audit-logs"), ADMINS),
    "create department": (
        lambda w, c: c.post(f"{w.base}/departments", json={"name": "New"}),
        ADMINS,
    ),
    "update own department": (
        lambda w, c: c.patch(f"{w.base}/departments/{w.engineering}", json={"description": "x"}),
        MANAGERS,
    ),
    "update another department": (
        lambda w, c: c.patch(f"{w.base}/departments/{w.sales}", json={"description": "x"}),
        ADMINS,
    ),
    "archive own department": (
        lambda w, c: c.post(f"{w.base}/departments/{w.engineering}/archive"),
        MANAGERS,
    ),
    "list join requests": (lambda w, c: c.get(f"{w.base}/membership-requests"), MANAGERS),
    "approve in own department": (
        lambda w, c: c.post(
            f"{w.base}/membership-requests/{w.engineering_request}/approve", json={}
        ),
        MANAGERS,
    ),
    "approve in another department": (
        lambda w, c: c.post(f"{w.base}/membership-requests/{w.sales_request}/approve", json={}),
        ADMINS,
    ),
    "approve with a role": (
        lambda w, c: c.post(
            f"{w.base}/membership-requests/{w.engineering_request}/approve",
            json={"role_key": "team_lead"},
        ),
        ADMINS,
    ),
    "reject in own department": (
        lambda w, c: c.post(
            f"{w.base}/membership-requests/{w.engineering_request}/reject", json={}
        ),
        MANAGERS,
    ),
    "create invitation": (lambda w, c: c.post(f"{w.base}/invitations", json={}), ADMINS),
    "list invitations": (lambda w, c: c.get(f"{w.base}/invitations"), ADMINS),
    "change a member's roles": (
        lambda w, c: c.patch(f"{w.member_url}/roles", json={"organization_role": "admin"}),
        ADMINS,
    ),
    "suspend a member": (lambda w, c: c.post(f"{w.member_url}/suspend", json={}), ADMINS),
    "remove a member": (lambda w, c: c.post(f"{w.member_url}/remove", json={}), ADMINS),
    "transfer a member": (
        lambda w, c: c.post(
            f"{w.member_url}/transfer",
            json={"from_department_id": w.engineering, "to_department_id": w.sales},
        ),
        ADMINS,
    ),
    "add a member to a department": (
        lambda w, c: c.post(f"{w.member_url}/departments", json={"department_id": w.sales}),
        ADMINS,
    ),
    "take a member out of a department": (
        lambda w, c: c.delete(f"{w.member_url}/departments/{w.engineering}"),
        ADMINS,
    ),
    "preview a change": (
        lambda w, c: c.get(f"{w.member_url}/impact", params={"action": "suspend"}),
        ADMINS,
    ),
    "transfer ownership": (
        lambda w, c: c.post(
            f"{w.base}/ownership-transfer",
            json={"membership_id": w.subject, "password": DEFAULT_PASSWORD},
        ),
        OWNER_ONLY,
    ),
    "create a task in own department": (
        lambda w, c: c.post(
            f"{w.base}/tasks", json={"title": "New", "department_id": w.engineering}
        ),
        set(ROLE_KEYS),
    ),
    "create a task in another department": (
        lambda w, c: c.post(f"{w.base}/tasks", json={"title": "New", "department_id": w.sales}),
        ADMINS,
    ),
    "share a task with the whole organization": (
        lambda w, c: c.post(
            f"{w.base}/tasks",
            json={"title": "New", "visibility": "organization"},
        ),
        ADMINS,
    ),
    "open own department's board": (
        lambda w, c: c.get(f"{w.base}/departments/{w.engineering}/board"),
        set(ROLE_KEYS),
    ),
    "open another department's board": (
        lambda w, c: c.get(f"{w.base}/departments/{w.sales}/board"),
        ADMINS,
    ),
    "update a colleague's task": (
        lambda w, c: c.patch(w.task_url, json={"priority": "high"}),
        LEADS,
    ),
    "assign a colleague's task": (
        lambda w, c: c.patch(w.task_url, json={"assigned_to": w.subject_user}),
        LEADS,
    ),
    "add a collaborator": (
        lambda w, c: c.post(f"{w.task_url}/collaborators", json={"user_id": w.subject_user}),
        LEADS,
    ),
    "archive a colleague's task": (lambda w, c: c.post(f"{w.task_url}/archive"), MANAGERS),
    "move a task to another department": (
        lambda w, c: c.patch(w.task_url, json={"department_id": w.sales}),
        ADMINS,
    ),
    "create an organization tag": (
        lambda w, c: c.post(f"{w.base}/tags", json={"name": "fresh"}),
        set(ROLE_KEYS),
    ),
    "delete an organization tag": (lambda w, c: c.delete(f"{w.base}/tags/{w.tag}"), ADMINS),
}


# Managers may approve in general, but a request outside their department isn't visible to them,
# so it answers 404 like anything else they can't see (ADR-010).
NOT_VISIBLE = {
    ("approve in another department", "department_manager"),
    *(
        (case, role)
        for case in ("create a task in another department", "open another department's board")
        for role in ("department_manager", "team_lead", "member")
    ),
    ("move a task to another department", "department_manager"),
    ("move a task to another department", "team_lead"),
}


@pytest.mark.parametrize("role_key", ROLE_KEYS)
@pytest.mark.parametrize("case", CASES)
def test_role_permission_matrix(world: World, role_key: str, case: str) -> None:
    attempt, allowed = CASES[case]
    response = attempt(world, world.clients[role_key])
    if role_key in allowed:
        assert response.status_code < 300, response.text
    elif (case, role_key) in NOT_VISIBLE:
        assert response.status_code == 404, response.text
    else:
        assert response.status_code == 403, response.text
        assert response.json()["error"]["code"] == "forbidden"


def test_reactivating_follows_the_same_permission(world: World) -> None:
    assert world.clients["owner"].post(f"{world.member_url}/suspend", json={}).status_code == 200
    for role_key in ("department_manager", "team_lead", "member"):
        response = world.clients[role_key].post(f"{world.member_url}/reactivate")
        assert response.status_code == 403
    assert world.clients["admin"].post(f"{world.member_url}/reactivate").status_code == 200


def test_outsiders_cannot_tell_the_endpoints_exist(world: World, make_api) -> None:
    stranger = make_api()
    register(stranger, email="stranger@example.com", name="Sue Stranger")
    assert (
        stranger.get(f"{world.member_url}/impact", params={"action": "remove"}).status_code == 404
    )
    assert stranger.post(f"{world.member_url}/suspend", json={}).status_code == 404
    response = stranger.post(
        f"{world.base}/ownership-transfer",
        json={"membership_id": world.subject, "password": DEFAULT_PASSWORD},
    )
    assert response.status_code == 404


def test_seeded_roles_match_the_code_catalog(api: ApiClient, db: Session) -> None:
    assert set(db.scalars(select(Permission.key))) == set(catalog.PERMISSIONS)
    roles = {role.key: role for role in db.scalars(select(Role))}
    assert set(roles) == set(catalog.ROLES)
    for key, (name, scope, _, granted) in catalog.ROLES.items():
        assert roles[key].name == name
        assert roles[key].scope_type == scope
        assert {p.key for p in roles[key].permissions} == set(granted)
