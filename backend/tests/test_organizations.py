from unittest.mock import patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.audit_logs.models import AuditLog
from app.modules.memberships.models import (
    DepartmentMembership,
    MembershipStatus,
    OrganizationMembership,
)
from app.modules.organizations.models import Organization
from app.modules.permissions import catalog
from app.modules.permissions.models import Permission, Role
from tests.conftest import ApiClient
from tests.factories import (
    create_org,
    create_task,
    departments_of,
    join_as,
    register,
    request_to_join,
)


@pytest.fixture
def owner(api: ApiClient) -> ApiClient:
    register(api, email="owner@example.com", name="Olivia Owner")
    return api


@pytest.fixture
def people(make_api):
    """Creates extra signed-in users on demand."""

    def factory(name: str) -> ApiClient:
        client = make_api()
        email = f"{name.lower().replace(' ', '.')}@example.com"
        assert register(client, email=email, name=name).status_code == 201
        return client

    return factory


# --- Seed data -------------------------------------------------------------------------------


def test_seeded_roles_match_the_code_catalog(api: ApiClient, db: Session) -> None:
    assert set(db.scalars(select(Permission.key))) == set(catalog.PERMISSIONS)
    roles = {role.key: role for role in db.scalars(select(Role))}
    assert set(roles) == set(catalog.ROLES)
    for key, (name, scope, _, granted) in catalog.ROLES.items():
        assert roles[key].name == name
        assert roles[key].scope_type == scope
        assert {p.key for p in roles[key].permissions} == set(granted)


# --- Creating organizations ------------------------------------------------------------------


def test_creator_becomes_owner_with_departments_and_audit(owner: ApiClient, db: Session) -> None:
    org = create_org(owner, "Acme Corp", departments=("Engineering", "Sales"))

    assert org["slug"] == "acme-corp"
    assert org["timezone"] == "Asia/Kolkata"  # defaults to the creator's timezone
    assert org["role_keys"] == ["owner"]
    assert set(org["permissions"]) == set(catalog.PERMISSIONS)
    assert set(departments_of(owner, org["id"])) == {"Engineering", "Sales"}
    assert [o["name"] for o in owner.get("/api/v1/me/organizations").json()] == ["Acme Corp"]
    actions = db.scalars(select(AuditLog.action).where(AuditLog.organization_id == org["id"]))
    assert "organization.created" in list(actions)


def test_same_name_gets_a_unique_slug(owner: ApiClient) -> None:
    assert create_org(owner, "Acme")["slug"] != create_org(owner, "Acme")["slug"]


def test_organization_creation_is_atomic(owner: ApiClient, db: Session) -> None:
    with patch("app.modules.organizations.service.audit.record", side_effect=RuntimeError("boom")):
        response = owner.post("/api/v1/organizations", json={"name": "Broken Inc"})

    assert response.status_code == 500
    assert db.scalar(select(func.count()).select_from(Organization)) == 0
    assert db.scalar(select(func.count()).select_from(OrganizationMembership)) == 0


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "A"},
        {"name": "Acme", "timezone": "Mars/Base"},
        {"name": "Acme", "website": "not-a-url"},
        {"name": "Acme", "departments": [{"name": "Ops"}, {"name": "ops"}]},
        {"name": "Acme", "status": "archived"},
    ],
)
def test_create_validates_input(owner: ApiClient, payload: dict) -> None:
    assert owner.post("/api/v1/organizations", json=payload).status_code == 422


# --- Tenant isolation ------------------------------------------------------------------------


def test_outsiders_get_404_on_every_organization_endpoint(owner: ApiClient, people) -> None:
    org = create_org(owner, discoverable=False)
    org_id = org["id"]
    department_id = departments_of(owner, org_id)["Engineering"]
    stranger = people("Sam Stranger")
    base = f"/api/v1/organizations/{org_id}"

    for path in (
        "",
        "/departments",
        "/members",
        "/membership-requests",
        "/invitations",
        "/audit-logs",
    ):
        assert stranger.get(base + path).status_code == 404, path
    assert stranger.patch(base, json={"name": "Hacked"}).status_code == 404
    assert stranger.post(f"{base}/departments", json={"name": "X"}).status_code == 404
    assert (
        stranger.patch(f"{base}/departments/{department_id}", json={"name": "X"}).status_code == 404
    )
    assert stranger.post(f"{base}/departments/{department_id}/archive").status_code == 404
    assert stranger.post(f"{base}/invitations", json={}).status_code == 404
    assert stranger.get("/api/v1/me/organizations").json() == []


def test_admin_of_one_org_cannot_reach_into_another(owner: ApiClient, people) -> None:
    org_a = create_org(owner, "Org A")
    rival = people("Rita Rival")
    org_b = create_org(rival, "Org B")
    b_department = departments_of(rival, org_b["id"])["Engineering"]
    applicant = people("Amy Applicant")
    a_department = departments_of(owner, org_a["id"])["Engineering"]
    b_request = request_to_join(applicant, org_b["id"], b_department).json()

    a = f"/api/v1/organizations/{org_a['id']}"
    # Org B's IDs through Org A's URLs are simply not found.
    assert owner.patch(f"{a}/departments/{b_department}", json={"name": "X"}).status_code == 404
    assert (
        owner.post(f"{a}/membership-requests/{b_request['id']}/approve", json={}).status_code == 404
    )
    assert owner.get(f"/api/v1/organizations/{org_b['id']}/members").status_code == 404

    # Placing someone in another organization's department is refused.
    a_request = request_to_join(people("Bob Applicant"), org_a["id"], a_department).json()
    wrong = owner.post(
        f"{a}/membership-requests/{a_request['id']}/approve",
        json={"department_id": b_department},
    )
    assert wrong.status_code == 422


def test_organization_never_sees_personal_tasks(owner: ApiClient, people) -> None:
    org = create_org(owner)
    employee = people("Eve Employee")
    join_as(owner, employee, org["id"], departments_of(owner, org["id"])["Sales"])
    private = create_task(employee, "Private diary")

    assert owner.get(f"/api/v1/tasks/{private['id']}").status_code == 404
    assert owner.get("/api/v1/me/tasks").json()["total"] == 0
    assert owner.get("/api/v1/me/dashboard").json()["counts"]["open"] == 0


# --- Discovery -------------------------------------------------------------------------------


def test_private_organizations_cannot_be_found_or_requested(owner: ApiClient, people) -> None:
    org = create_org(owner, "Hidden Co", discoverable=False)
    stranger = people("Sam Stranger")

    assert (
        stranger.get("/api/v1/organizations/discover", params={"q": "Hidden"}).json()["total"] == 0
    )
    assert stranger.get(f"/api/v1/organizations/{org['id']}/join-info").status_code == 404
    assert request_to_join(stranger, org["id"], None).status_code == 404


def test_discovery_exposes_only_public_fields(owner: ApiClient, people) -> None:
    org = create_org(owner, "Visible 100% Co", description="We build things")
    stranger = people("Sam Stranger")

    page = stranger.get("/api/v1/organizations/discover", params={"q": "100%"}).json()

    assert page["total"] == 1
    item = page["items"][0]
    assert item["my_status"] == "none"
    assert set(item) == {"id", "name", "description", "location", "website", "my_status"}
    assert stranger.get("/api/v1/organizations/discover", params={"q": "%%"}).json()["total"] == 0
    assert stranger.get("/api/v1/organizations/discover", params={"q": "x"}).status_code == 422

    info = stranger.get(f"/api/v1/organizations/{org['id']}/join-info").json()
    assert {d["name"] for d in info["departments"]} == {"Engineering", "Sales"}


# --- Join requests ---------------------------------------------------------------------------


def test_pending_request_grants_nothing_until_approved(
    owner: ApiClient, people, db: Session
) -> None:
    org = create_org(owner)
    org_id = org["id"]
    engineering = departments_of(owner, org_id)["Engineering"]
    applicant = people("Amy Applicant")
    base = f"/api/v1/organizations/{org_id}"

    created = request_to_join(applicant, org_id, engineering, job_title="Engineer", note="Hi!")
    assert created.status_code == 201
    assert created.json()["status"] == "pending"
    assert created.json()["requested_department_name"] == "Engineering"

    # Pending: no access at all, and it's listed as pending for the applicant.
    assert applicant.get(base).status_code == 404
    assert applicant.get(f"{base}/departments").status_code == 404
    assert applicant.get("/api/v1/me/organizations").json() == []
    info = applicant.get(f"{base}/join-info").json()
    assert info["my_status"] == "pending"

    # The database allows only one pending request.
    duplicate = request_to_join(applicant, org_id, engineering)
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "request_pending"

    queue = owner.get(f"{base}/membership-requests", params={"status": "pending"}).json()
    assert queue["total"] == 1 and queue["items"][0]["user_name"] == "Amy Applicant"

    approved = owner.post(f"{base}/membership-requests/{created.json()['id']}/approve", json={})
    assert approved.status_code == 200 and approved.json()["status"] == "approved"

    mine = applicant.get("/api/v1/me/organizations").json()
    assert [o["id"] for o in mine] == [org_id]
    assert mine[0]["role_keys"] == ["member"]
    assert mine[0]["department_ids"] == [engineering]
    assert applicant.get(base).status_code == 200
    assert db.scalar(select(func.count()).select_from(DepartmentMembership)) == 1
    membership = db.scalar(
        select(OrganizationMembership).where(OrganizationMembership.job_title == "Engineer")
    )
    assert membership is not None and membership.primary_department_id == engineering

    # Deciding twice is refused; rejoining is refused.
    again = owner.post(f"{base}/membership-requests/{created.json()['id']}/approve", json={})
    assert again.status_code == 409
    assert (
        request_to_join(applicant, org_id, engineering).json()["error"]["code"] == "already_member"
    )


def test_approval_is_atomic(owner: ApiClient, people, db: Session) -> None:
    org = create_org(owner)
    engineering = departments_of(owner, org["id"])["Engineering"]
    applicant = people("Amy Applicant")
    request = request_to_join(applicant, org["id"], engineering).json()

    with patch("app.modules.memberships.service.audit.record", side_effect=RuntimeError("boom")):
        failed = owner.post(
            f"/api/v1/organizations/{org['id']}/membership-requests/{request['id']}/approve",
            json={},
        )

    assert failed.status_code == 500
    assert applicant.get("/api/v1/me/organizations").json() == []
    assert db.scalar(select(func.count()).select_from(DepartmentMembership)) == 0
    # Still pending, so it can be approved properly afterwards.
    queue = owner.get(f"/api/v1/organizations/{org['id']}/membership-requests").json()
    assert queue["items"][0]["status"] == "pending"


def test_approver_can_amend_department_and_role(owner: ApiClient, people) -> None:
    org = create_org(owner)
    departments = departments_of(owner, org["id"])
    applicant = people("Amy Applicant")
    request = request_to_join(applicant, org["id"], departments["Engineering"]).json()

    response = owner.post(
        f"/api/v1/organizations/{org['id']}/membership-requests/{request['id']}/approve",
        json={"department_id": departments["Sales"], "role_key": "team_lead"},
    )

    assert response.status_code == 200
    mine = applicant.get("/api/v1/me/organizations").json()[0]
    assert mine["department_ids"] == [departments["Sales"]]
    assert mine["role_keys"] == ["member", "team_lead"]
    # The lead role is scoped: its extras apply in Sales only.
    assert "task.assign" not in mine["permissions"]
    assert "task.assign" in mine["department_permissions"][str(departments["Sales"])]


def test_department_roles_need_a_department_and_owner_cannot_be_granted(
    owner: ApiClient, people
) -> None:
    org = create_org(owner, departments=())  # no open departments: department is optional
    applicant = people("Amy Applicant")
    request = request_to_join(applicant, org["id"], None).json()
    url = f"/api/v1/organizations/{org['id']}/membership-requests/{request['id']}/approve"

    assert owner.post(url, json={"role_key": "team_lead"}).status_code == 422
    assert owner.post(url, json={"role_key": "owner"}).status_code == 422
    assert owner.post(url, json={"role_key": "admin"}).status_code == 200


def test_rejection_grants_no_access_and_allows_a_new_request(owner: ApiClient, people) -> None:
    org = create_org(owner)
    engineering = departments_of(owner, org["id"])["Engineering"]
    applicant = people("Amy Applicant")
    request = request_to_join(applicant, org["id"], engineering).json()

    rejected = owner.post(
        f"/api/v1/organizations/{org['id']}/membership-requests/{request['id']}/reject",
        json={"note": "Hiring is paused"},
    )

    assert rejected.json()["status"] == "rejected"
    assert applicant.get("/api/v1/me/organizations").json() == []
    mine = applicant.get("/api/v1/me/membership-requests").json()
    assert mine[0]["status"] == "rejected" and mine[0]["review_note"] == "Hiring is paused"
    assert request_to_join(applicant, org["id"], engineering).status_code == 201


def test_requester_can_cancel_only_their_own_pending_request(owner: ApiClient, people) -> None:
    org = create_org(owner)
    engineering = departments_of(owner, org["id"])["Engineering"]
    applicant = people("Amy Applicant")
    request = request_to_join(applicant, org["id"], engineering).json()

    url = f"/api/v1/me/membership-requests/{request['id']}/cancel"
    assert people("Mallory").post(url).status_code == 404
    assert applicant.post(url).status_code == 204
    assert applicant.post(url).status_code == 409


def test_only_open_active_departments_can_be_requested(owner: ApiClient, people) -> None:
    org = create_org(owner)
    departments = departments_of(owner, org["id"])
    base = f"/api/v1/organizations/{org['id']}"
    owner.patch(
        f"{base}/departments/{departments['Sales']}", json={"open_for_join_requests": False}
    )
    owner.post(f"{base}/departments/{departments['Engineering']}/archive")
    applicant = people("Amy Applicant")

    assert request_to_join(applicant, org["id"], departments["Sales"]).status_code == 422
    assert request_to_join(applicant, org["id"], departments["Engineering"]).status_code == 422
    assert applicant.get(f"{base}/join-info").json()["departments"] == []
    # Nothing open: the department may be left out.
    assert request_to_join(applicant, org["id"], None).status_code == 201


def test_department_is_required_when_some_are_open(owner: ApiClient, people) -> None:
    org = create_org(owner)
    response = request_to_join(people("Amy Applicant"), org["id"], None)
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "department_id"


# --- Who may approve -------------------------------------------------------------------------


def test_members_cannot_administer(owner: ApiClient, people) -> None:
    org = create_org(owner)
    org_id = org["id"]
    departments = departments_of(owner, org_id)
    member = people("Mia Member")
    join_as(owner, member, org_id, departments["Sales"])
    pending = request_to_join(people("Amy Applicant"), org_id, departments["Sales"]).json()
    base = f"/api/v1/organizations/{org_id}"

    assert member.get(f"{base}/membership-requests").status_code == 403
    assert (
        member.post(f"{base}/membership-requests/{pending['id']}/approve", json={}).status_code
        == 403
    )
    assert (
        member.post(f"{base}/membership-requests/{pending['id']}/reject", json={}).status_code
        == 403
    )
    assert member.patch(base, json={"name": "Mine now"}).status_code == 403
    assert member.post(f"{base}/departments", json={"name": "X"}).status_code == 403
    assert member.post(f"{base}/invitations", json={}).status_code == 403
    assert member.get(f"{base}/invitations").status_code == 403
    assert member.get(f"{base}/audit-logs").status_code == 403


def test_department_manager_is_limited_to_their_department(owner: ApiClient, people) -> None:
    org = create_org(owner)
    org_id = org["id"]
    departments = departments_of(owner, org_id)
    base = f"/api/v1/organizations/{org_id}"
    manager = people("Max Manager")
    join_as(owner, manager, org_id, departments["Sales"], role_key="department_manager")

    sales_applicant = request_to_join(people("Sue Sales"), org_id, departments["Sales"]).json()
    eng_applicant = request_to_join(people("Eli Eng"), org_id, departments["Engineering"]).json()

    queue = manager.get(f"{base}/membership-requests").json()
    assert [r["id"] for r in queue["items"] if r["status"] == "pending"] == [sales_applicant["id"]]
    # Other department's request is invisible; they can't grant admin or move people elsewhere.
    assert (
        manager.post(
            f"{base}/membership-requests/{eng_applicant['id']}/approve", json={}
        ).status_code
        == 404
    )
    approve = f"{base}/membership-requests/{sales_applicant['id']}/approve"
    assert manager.post(approve, json={"role_key": "admin"}).status_code == 403
    assert (
        manager.post(approve, json={"department_id": departments["Engineering"]}).status_code == 403
    )
    assert manager.post(approve, json={}).status_code == 200
    # They can edit their own department, not others.
    assert (
        manager.patch(
            f"{base}/departments/{departments['Sales']}", json={"description": "x"}
        ).status_code
        == 200
    )
    assert (
        manager.patch(
            f"{base}/departments/{departments['Engineering']}", json={"description": "x"}
        ).status_code
        == 403
    )


# --- Access revocation -----------------------------------------------------------------------


@pytest.mark.parametrize("new_status", [MembershipStatus.SUSPENDED, MembershipStatus.REMOVED])
def test_losing_membership_takes_effect_on_the_next_request(
    owner: ApiClient, people, db: Session, new_status: MembershipStatus
) -> None:
    org = create_org(owner)
    member = people("Mia Member")
    join_as(owner, member, org["id"], departments_of(owner, org["id"])["Sales"])
    assert member.get(f"/api/v1/organizations/{org['id']}").status_code == 200

    membership = db.scalar(
        select(OrganizationMembership)
        .where(OrganizationMembership.organization_id == org["id"])
        .order_by(OrganizationMembership.id.desc())
    )
    assert membership is not None
    membership.status = new_status
    db.commit()

    assert member.get(f"/api/v1/organizations/{org['id']}").status_code == 404
    assert member.get("/api/v1/me/organizations").json() == []


# --- Departments -----------------------------------------------------------------------------


def test_department_lifecycle(owner: ApiClient, db: Session) -> None:
    org = create_org(owner, departments=())
    base = f"/api/v1/organizations/{org['id']}/departments"

    created = owner.post(base, json={"name": "Support", "description": "Helps customers"})
    assert created.status_code == 201
    department_id = created.json()["id"]
    duplicate = owner.post(base, json={"name": "support"})
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "department_name_taken"

    renamed = owner.patch(f"{base}/{department_id}", json={"name": "Customer Care"})
    assert renamed.json()["name"] == "Customer Care"

    archived = owner.post(f"{base}/{department_id}/archive").json()
    assert archived["status"] == "archived" and archived["open_for_join_requests"] is False
    assert owner.get(base).json() == []
    assert len(owner.get(base, params={"include_archived": "true"}).json()) == 1

    assert owner.post(f"{base}/{department_id}/restore").json()["status"] == "active"
    actions = list(db.scalars(select(AuditLog.action).where(AuditLog.target_type == "department")))
    assert {"department.created", "department.updated", "department.archived"} <= set(actions)


def test_members_only_see_their_own_departments(owner: ApiClient, people) -> None:
    org = create_org(owner)
    departments = departments_of(owner, org["id"])
    member = people("Mia Member")
    join_as(owner, member, org["id"], departments["Sales"])

    assert list(departments_of(member, org["id"])) == ["Sales"]


# --- Members and settings --------------------------------------------------------------------


def test_member_directory_scope_and_search(owner: ApiClient, people) -> None:
    org = create_org(owner)
    org_id = org["id"]
    departments = departments_of(owner, org_id)
    sales = people("Sue Sales")
    sales_peer = people("Sam Seller")
    engineer = people("Eli Engineer")
    join_as(owner, sales, org_id, departments["Sales"])
    join_as(owner, sales_peer, org_id, departments["Sales"])
    join_as(owner, engineer, org_id, departments["Engineering"])
    url = f"/api/v1/organizations/{org_id}/members"

    everyone = owner.get(url).json()
    assert everyone["total"] == 4
    roles = {m["name"]: [r["key"] for r in m["roles"]] for m in everyone["items"]}
    assert roles["Olivia Owner"] == ["owner"]

    # A member sees their department, not the whole organization.
    assert {m["name"] for m in sales.get(url).json()["items"]} == {"Sue Sales", "Sam Seller"}
    assert owner.get(url, params={"q": "eli"}).json()["total"] == 1
    assert owner.get(url, params={"department_id": departments["Sales"]}).json()["total"] == 2


def test_settings_and_audit_log(owner: ApiClient) -> None:
    org = create_org(owner, discoverable=False)
    base = f"/api/v1/organizations/{org['id']}"

    updated = owner.patch(
        base, json={"description": "New", "is_discoverable": True, "review_required": True}
    ).json()
    assert updated["is_discoverable"] is True and updated["review_required"] is True
    assert owner.patch(base, json={"website": "ftp://nope"}).status_code == 422
    assert owner.patch(base, json={"id": 5}).status_code == 422

    log = owner.get(f"{base}/audit-logs").json()
    assert [entry["action"] for entry in log["items"]][:2] == [
        "organization.updated",
        "organization.created",
    ]
    assert log["items"][0]["actor_name"] == "Olivia Owner"
