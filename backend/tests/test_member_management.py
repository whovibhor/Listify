from typing import Any
from unittest.mock import patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.audit_logs.models import AuditLog
from app.modules.memberships.models import (
    DepartmentMembership,
    MembershipRole,
    MembershipStatus,
    OrganizationMembership,
)
from app.modules.permissions.models import Role
from tests.conftest import ApiClient
from tests.factories import (
    DEFAULT_PASSWORD,
    create_org,
    create_task,
    departments_of,
    join_as,
    list_tasks,
    register,
    request_to_join,
)


@pytest.fixture
def owner(api: ApiClient) -> ApiClient:
    register(api, email="owner@example.com", name="Olivia Owner")
    return api


@pytest.fixture
def people(make_api):
    def factory(name: str) -> ApiClient:
        client = make_api()
        email = f"{name.lower().replace(' ', '.')}@example.com"
        assert register(client, email=email, name=name).status_code == 201
        return client

    return factory


class Org:
    """Shorthand for one organization's URLs, plus adding people to it."""

    def __init__(self, owner: ApiClient) -> None:
        self.owner = owner
        self.data = create_org(owner, departments=("Engineering", "Sales", "Support"))
        self.id: int = self.data["id"]
        self.base = f"/api/v1/organizations/{self.id}"
        self.departments = departments_of(owner, self.id)
        self.engineering = self.departments["Engineering"]
        self.sales = self.departments["Sales"]
        self.support = self.departments["Support"]

    def join(self, client: ApiClient, role_key: str = "member", department: str = "Engineering"):
        join_as(self.owner, client, self.id, self.departments[department], role_key=role_key)

    def member(self, name: str, viewer: ApiClient | None = None) -> dict[str, Any]:
        response = (viewer or self.owner).get(f"{self.base}/members", params={"q": name})
        assert response.status_code == 200, response.text
        return response.json()["items"][0]

    def url(self, name: str, suffix: str = "") -> str:
        return f"{self.base}/members/{self.member(name)['membership_id']}{suffix}"

    def transfer(self, name: str, source: int, destination: int, client: ApiClient | None = None):
        return (client or self.owner).post(
            self.url(name, "/transfer"),
            json={"from_department_id": source, "to_department_id": destination},
        )

    def department_names(self, client: ApiClient) -> set[str]:
        return {d["name"] for d in client.get(f"{self.base}/departments").json()}


@pytest.fixture
def org(owner: ApiClient) -> Org:
    return Org(owner)


def error_code(response: Any) -> str:
    return response.json()["error"]["code"]


def role_keys(member: dict[str, Any]) -> set[tuple[str, int | None]]:
    return {(role["key"], role["department_id"]) for role in member["roles"]}


def audit_rows(db: Session, action: str) -> list[AuditLog]:
    db.rollback()
    return list(db.scalars(select(AuditLog).where(AuditLog.action == action)))


# --- Roles -----------------------------------------------------------------------------------


def test_department_role_applies_from_the_next_request_and_only_there(org: Org, people) -> None:
    manager = people("Max Manager")
    org.join(manager)
    assert manager.get(f"{org.base}/membership-requests").status_code == 403

    response = org.owner.patch(
        org.url("Max Manager", "/roles"),
        json={
            "organization_role": "member",
            "department_roles": [
                {"department_id": org.engineering, "role_key": "department_manager"}
            ],
        },
    )

    assert response.status_code == 200, response.text
    assert role_keys(response.json()) == {
        ("member", None),
        ("department_manager", org.engineering),
    }
    assert manager.get(f"{org.base}/membership-requests").status_code == 200
    assert (
        manager.patch(
            f"{org.base}/departments/{org.engineering}", json={"description": "Mine"}
        ).status_code
        == 200
    )
    assert (
        manager.patch(
            f"{org.base}/departments/{org.sales}", json={"description": "Not mine"}
        ).status_code
        == 403
    )


def test_demoting_an_admin_takes_effect_on_the_next_request(org: Org, people, db: Session) -> None:
    admin = people("Ann Admin")
    org.join(admin, "admin")
    assert admin.get(f"{org.base}/audit-logs").status_code == 200

    response = org.owner.patch(org.url("Ann Admin", "/roles"), json={"organization_role": "member"})

    assert role_keys(response.json()) == {("member", None)}
    assert admin.get(f"{org.base}/audit-logs").status_code == 403
    assert admin.get("/api/v1/me/organizations").json()[0]["role_keys"] == ["member"]
    assert len(audit_rows(db, "member.roles_changed")) == 1


def test_saving_the_same_roles_records_nothing(org: Org, people, db: Session) -> None:
    org.join(people("Mia Member"))
    response = org.owner.patch(
        org.url("Mia Member", "/roles"), json={"organization_role": "member"}
    )
    assert response.status_code == 200
    assert audit_rows(db, "member.roles_changed") == []


def test_roles_can_be_held_in_several_departments(org: Org, people) -> None:
    lead = people("Lee Lead")
    org.join(lead, "team_lead")
    org.owner.post(org.url("Lee Lead", "/departments"), json={"department_id": org.sales})

    both = org.owner.patch(
        org.url("Lee Lead", "/roles"),
        json={
            "organization_role": "member",
            "department_roles": [
                {"department_id": org.engineering, "role_key": "team_lead"},
                {"department_id": org.sales, "role_key": "department_manager"},
            ],
        },
    )
    assert role_keys(both.json()) == {
        ("member", None),
        ("team_lead", org.engineering),
        ("department_manager", org.sales),
    }

    cleared = org.owner.patch(org.url("Lee Lead", "/roles"), json={"organization_role": "member"})
    assert role_keys(cleared.json()) == {("member", None)}


@pytest.mark.parametrize(
    "body",
    [
        {"organization_role": "owner"},
        {"organization_role": "team_lead"},
        {"organization_role": "member", "unknown": 1},
        {
            "organization_role": "member",
            "department_roles": [{"department_id": 1, "role_key": "admin"}],
        },
        {
            "organization_role": "member",
            "department_roles": [
                {"department_id": 1, "role_key": "team_lead"},
                {"department_id": 1, "role_key": "department_manager"},
            ],
        },
    ],
)
def test_invalid_role_requests_are_refused(org: Org, people, body: dict[str, Any]) -> None:
    org.join(people("Mia Member"))
    response = org.owner.patch(org.url("Mia Member", "/roles"), json=body)
    assert response.status_code == 422


def test_department_role_needs_active_membership_of_that_department(org: Org, people) -> None:
    org.join(people("Mia Member"))
    choice = {
        "organization_role": "member",
        "department_roles": [{"department_id": org.sales, "role_key": "team_lead"}],
    }

    outside = org.owner.patch(org.url("Mia Member", "/roles"), json=choice)
    assert outside.status_code == 422

    org.owner.post(org.url("Mia Member", "/departments"), json={"department_id": org.sales})
    org.owner.post(f"{org.base}/departments/{org.sales}/archive")
    archived = org.owner.patch(org.url("Mia Member", "/roles"), json=choice)
    assert archived.status_code == 422


def test_existing_role_in_an_archived_department_does_not_block_other_changes(
    org: Org, people
) -> None:
    org.join(people("Lee Lead"), "team_lead")
    org.owner.post(f"{org.base}/departments/{org.engineering}/archive")

    response = org.owner.patch(
        org.url("Lee Lead", "/roles"),
        json={
            "organization_role": "admin",
            "department_roles": [{"department_id": org.engineering, "role_key": "team_lead"}],
        },
    )

    assert response.status_code == 200, response.text


# --- Who can be changed ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("patch", "/roles", {"organization_role": "member"}),
        ("post", "/suspend", {}),
        ("post", "/remove", {}),
        ("post", "/departments", {"department_id": 0}),
    ],
)
def test_admin_cannot_touch_the_owner(
    org: Org, people, method: str, suffix: str, body: dict[str, Any]
) -> None:
    admin = people("Ann Admin")
    org.join(admin, "admin")
    response = getattr(admin, method)(org.url("Olivia Owner", suffix), json=body)
    assert response.status_code == 403
    assert error_code(response) == "owner_protected"
    assert org.member("Olivia Owner")["status"] == "active"
    assert ("owner", None) in role_keys(org.member("Olivia Owner"))


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("patch", "/roles", {"organization_role": "member"}),
        ("post", "/suspend", {}),
        ("post", "/remove", {}),
    ],
)
def test_nobody_can_lock_themselves_out(
    org: Org, people, method: str, suffix: str, body: dict[str, Any]
) -> None:
    admin = people("Ann Admin")
    org.join(admin, "admin")
    for client, name in ((org.owner, "Olivia Owner"), (admin, "Ann Admin")):
        response = getattr(client, method)(org.url(name, suffix), json=body)
        assert response.status_code == 403
        assert error_code(response) == "own_membership"


def test_owner_cannot_role_change_their_own_way_out(org: Org) -> None:
    assert "change_roles" not in org.member("Olivia Owner")["actions"]
    assert "suspend" not in org.member("Olivia Owner")["actions"]


def test_admin_can_manage_another_admin(org: Org, people) -> None:
    first, second = people("Ann Admin"), people("Bea Admin")
    org.join(first, "admin")
    org.join(second, "admin")
    assert first.post(org.url("Bea Admin", "/suspend"), json={}).status_code == 200
    assert second.get(org.base).status_code == 404


def test_directory_says_what_the_viewer_may_do(org: Org, people) -> None:
    admin, member = people("Ann Admin"), people("Mia Member")
    org.join(admin, "admin")
    org.join(member)

    assert set(org.member("Mia Member")["actions"]) == {
        "change_roles",
        "suspend",
        "remove",
        "transfer",
        "add_department",
        "leave_department",
        "make_owner",
    }
    assert set(org.member("Olivia Owner")["actions"]) == {
        "transfer",
        "add_department",
        "leave_department",
    }
    assert org.member("Olivia Owner", admin)["actions"] == []
    assert "make_owner" not in org.member("Mia Member", admin)["actions"]
    assert org.member("Ann Admin", member)["actions"] == []

    org.owner.post(org.url("Mia Member", "/suspend"), json={})
    assert set(org.member("Mia Member")["actions"]) == {"reactivate", "remove"}


def test_directory_can_be_filtered_by_status(org: Org, people) -> None:
    org.join(people("Mia Member"))
    org.owner.post(org.url("Mia Member", "/suspend"), json={})
    suspended = org.owner.get(f"{org.base}/members", params={"status": "suspended"}).json()
    assert [member["name"] for member in suspended["items"]] == ["Mia Member"]


def test_ids_from_another_organization_are_not_found(org: Org, people) -> None:
    rival = people("Rita Rival")
    other = Org(rival)
    url = other.url("Rita Rival", "/suspend")
    assert org.owner.post(url.replace(other.base, org.base), json={}).status_code == 404
    response = org.owner.post(
        f"{org.base}/ownership-transfer",
        json={
            "membership_id": other.member("Rita Rival")["membership_id"],
            "password": DEFAULT_PASSWORD,
        },
    )
    assert response.status_code == 404


# --- Suspension ------------------------------------------------------------------------------


def test_suspended_member_requests_fail(org: Org, people, db: Session) -> None:
    member = people("Mia Member")
    org.join(member)
    create_task(member, "My private errand")

    response = org.owner.post(
        org.url("Mia Member", "/suspend"), json={"reason": "On investigation"}
    )

    assert response.status_code == 200
    assert response.json()["status"] == "suspended"
    # Same session, next request: the organization is gone, personal work is untouched.
    assert member.get(org.base).status_code == 404
    assert member.get(f"{org.base}/members").status_code == 404
    assert member.get("/api/v1/me/organizations").json() == []
    assert [task["title"] for task in list_tasks(member, view="all")["items"]] == [
        "My private errand"
    ]
    # Suspended people can't rejoin by themselves.
    rejoin = request_to_join(member, org.id, org.sales)
    assert rejoin.status_code == 409 and error_code(rejoin) == "member_suspended"
    assert audit_rows(db, "member.suspended")[0].details["reason"] == "On investigation"


def test_reactivating_restores_roles_and_departments(org: Org, people) -> None:
    manager = people("Max Manager")
    org.join(manager, "department_manager")
    before = org.member("Max Manager")

    org.owner.post(org.url("Max Manager", "/suspend"), json={})
    response = org.owner.post(org.url("Max Manager", "/reactivate"))

    assert response.status_code == 200
    assert role_keys(response.json()) == role_keys(before)
    assert response.json()["departments"] == before["departments"]
    assert manager.get(f"{org.base}/membership-requests").status_code == 200


def test_actions_need_the_right_state(org: Org, people) -> None:
    org.join(people("Mia Member"))
    active_reactivate = org.owner.post(org.url("Mia Member", "/reactivate"))
    assert active_reactivate.status_code == 409 and error_code(active_reactivate) == "member_state"

    org.owner.post(org.url("Mia Member", "/suspend"), json={})
    for method, suffix, body in (
        ("post", "/suspend", {}),
        ("patch", "/roles", {"organization_role": "admin"}),
        ("post", "/departments", {"department_id": org.sales}),
    ):
        response = getattr(org.owner, method)(org.url("Mia Member", suffix), json=body)
        assert response.status_code == 409 and error_code(response) == "member_state"


# --- Removal ---------------------------------------------------------------------------------


def test_removing_revokes_access_and_keeps_history(org: Org, people, db: Session) -> None:
    member = people("Lee Lead")
    org.join(member, "team_lead")
    url = org.url("Lee Lead", "/remove")

    assert org.owner.post(url, json={"reason": "Left the company"}).status_code == 204

    assert member.get(org.base).status_code == 404
    listing = org.owner.get(f"{org.base}/members", params={"q": "Lee Lead"}).json()
    assert listing["total"] == 0

    db.rollback()
    membership = db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == org.id,
            OrganizationMembership.status == MembershipStatus.REMOVED,
        )
    )
    assert membership is not None and membership.primary_department_id is None
    assert (
        db.scalar(
            select(func.count())
            .select_from(MembershipRole)
            .where(MembershipRole.membership_id == membership.id)
        )
        == 0
    )
    assert (
        db.scalar(
            select(func.count())
            .select_from(DepartmentMembership)
            .where(DepartmentMembership.user_id == membership.user_id)
        )
        == 0
    )
    entry = audit_rows(db, "member.removed")[0]
    assert entry.details["reason"] == "Left the company"
    assert entry.details["user_name"] == "Lee Lead"
    assert sorted(entry.details["roles"]) == ["member", "team_lead"]
    assert entry.details["department_ids"] == [org.engineering]

    assert org.owner.post(url, json={}).status_code == 404


def test_removed_member_can_rejoin_without_old_access(org: Org, people) -> None:
    member = people("Max Manager")
    org.join(member, "department_manager")
    org.owner.post(org.url("Max Manager", "/remove"), json={})

    org.join(member, department="Sales")

    rejoined = org.member("Max Manager")
    assert role_keys(rejoined) == {("member", None)}
    assert [department["name"] for department in rejoined["departments"]] == ["Sales"]


def test_suspended_member_can_be_removed(org: Org, people) -> None:
    org.join(people("Mia Member"))
    org.owner.post(org.url("Mia Member", "/suspend"), json={})
    assert org.owner.post(org.url("Mia Member", "/remove"), json={}).status_code == 204


# --- Departments -----------------------------------------------------------------------------


def test_transfer_revokes_old_dept(org: Org, people, db: Session) -> None:
    lead = people("Lee Lead")
    org.join(lead, "team_lead")
    assert org.department_names(lead) == {"Engineering"}

    response = org.transfer("Lee Lead", org.engineering, org.sales)

    assert response.status_code == 200, response.text
    assert [d["name"] for d in response.json()["departments"]] == ["Sales"]
    # The role belonged to the old department, so it ends there.
    assert role_keys(response.json()) == {("member", None)}
    assert org.department_names(lead) == {"Sales"}
    assert lead.get(org.base).status_code == 200

    db.rollback()
    membership = db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.user_id == response.json()["user_id"]
        )
    )
    assert membership is not None and membership.primary_department_id == org.sales
    entry = audit_rows(db, "member.transferred")[0]
    assert entry.details["from_department"] == "Engineering"
    assert entry.details["to_department"] == "Sales"
    assert entry.details["roles_ended"] == ["team_lead"]


def test_transfer_keeps_other_departments_and_primary(org: Org, people, db: Session) -> None:
    member = people("Mia Member")
    org.join(member)
    org.owner.post(org.url("Mia Member", "/departments"), json={"department_id": org.sales})

    org.transfer("Mia Member", org.sales, org.support)

    assert org.department_names(member) == {"Engineering", "Support"}
    db.rollback()
    membership = db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.user_id == org.member("Mia Member")["user_id"]
        )
    )
    assert membership is not None and membership.primary_department_id == org.engineering


def test_transfer_leaves_org_wide_access_in_place(org: Org, people) -> None:
    admin = people("Ann Admin")
    org.join(admin, "admin")
    org.transfer("Ann Admin", org.engineering, org.sales)
    assert org.department_names(admin) == {"Engineering", "Sales", "Support"}
    assert admin.get(f"{org.base}/audit-logs").status_code == 200


def test_transfer_is_validated(org: Org, people) -> None:
    org.join(people("Mia Member"))
    org.owner.post(org.url("Mia Member", "/departments"), json={"department_id": org.sales})

    assert org.transfer("Mia Member", org.support, org.engineering).status_code == 422
    assert org.transfer("Mia Member", org.engineering, org.engineering).status_code == 422
    taken = org.transfer("Mia Member", org.engineering, org.sales)
    assert taken.status_code == 409 and error_code(taken) == "already_in_department"
    assert org.transfer("Mia Member", org.engineering, 999_999).status_code == 422

    org.owner.post(f"{org.base}/departments/{org.support}/archive")
    assert org.transfer("Mia Member", org.engineering, org.support).status_code == 422


def test_transfer_out_of_another_organizations_department_is_refused(org: Org, people) -> None:
    rival = people("Rita Rival")
    other = Org(rival)
    org.join(people("Mia Member"))
    assert org.transfer("Mia Member", org.engineering, other.engineering).status_code == 422


def test_transfer_commits_with_its_audit_row_or_not_at_all(org: Org, people) -> None:
    member = people("Mia Member")
    org.join(member)
    with patch("app.modules.memberships.management.audit.record", side_effect=RuntimeError("boom")):
        response = org.transfer("Mia Member", org.engineering, org.sales)

    assert response.status_code == 500
    assert org.department_names(member) == {"Engineering"}


def test_adding_a_department_grants_it_alongside_the_others(org: Org, people, db: Session) -> None:
    member = people("Mia Member")
    org.join(member)

    response = org.owner.post(
        org.url("Mia Member", "/departments"), json={"department_id": org.sales}
    )

    assert response.status_code == 200
    assert org.department_names(member) == {"Engineering", "Sales"}
    again = org.owner.post(org.url("Mia Member", "/departments"), json={"department_id": org.sales})
    assert again.status_code == 409 and error_code(again) == "already_in_department"
    assert len(audit_rows(db, "member.department_added")) == 1


def test_archived_department_cannot_be_added(org: Org, people) -> None:
    org.join(people("Mia Member"))
    org.owner.post(f"{org.base}/departments/{org.sales}/archive")
    response = org.owner.post(
        org.url("Mia Member", "/departments"), json={"department_id": org.sales}
    )
    assert response.status_code == 422


def test_leaving_a_department_ends_its_role_and_moves_the_primary(
    org: Org, people, db: Session
) -> None:
    lead = people("Lee Lead")
    org.join(lead, "team_lead")
    org.owner.post(org.url("Lee Lead", "/departments"), json={"department_id": org.sales})

    response = org.owner.delete(org.url("Lee Lead", f"/departments/{org.engineering}"))

    assert response.status_code == 200, response.text
    assert role_keys(response.json()) == {("member", None)}
    assert org.department_names(lead) == {"Sales"}
    db.rollback()
    membership = db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.user_id == response.json()["user_id"]
        )
    )
    assert membership is not None and membership.primary_department_id == org.sales

    last = org.owner.delete(org.url("Lee Lead", f"/departments/{org.sales}"))
    assert last.json()["departments"] == []
    assert org.owner.delete(org.url("Lee Lead", f"/departments/{org.sales}")).status_code == 422


def test_owner_may_change_their_own_departments(org: Org) -> None:
    response = org.owner.post(
        org.url("Olivia Owner", "/departments"), json={"department_id": org.sales}
    )
    assert response.status_code == 200, response.text


# --- Impact preview --------------------------------------------------------------------------


def test_transfer_preview(org: Org, people, db: Session) -> None:
    org.join(people("Max Manager"), "department_manager")
    org.owner.post(org.url("Max Manager", "/departments"), json={"department_id": org.sales})
    request_to_join(people("Amy Applicant"), org.id, org.engineering)
    before = org.member("Max Manager")

    response = org.owner.get(
        org.url("Max Manager", "/impact"),
        params={
            "action": "transfer",
            "from_department_id": org.engineering,
            "to_department_id": org.support,
        },
    )

    assert response.status_code == 200, response.text
    impact = response.json()
    assert impact["member_name"] == "Max Manager"
    assert [d["name"] for d in impact["departments_losing"]] == ["Engineering"]
    assert [d["name"] for d in impact["departments_gaining"]] == ["Support"]
    assert [d["name"] for d in impact["departments_keeping"]] == ["Sales"]
    assert [role["key"] for role in impact["roles_ending"]] == ["department_manager"]
    assert [d["name"] for d in impact["sole_manager_of"]] == ["Engineering"]
    assert impact["pending_requests"] == 1
    assert impact["keeps_every_department"] is False
    # A preview changes nothing.
    assert org.member("Max Manager") == before
    assert audit_rows(db, "member.transferred") == []


def test_preview_says_when_another_path_keeps_access(org: Org, people) -> None:
    org.join(people("Ann Admin"), "admin")
    impact = org.owner.get(
        org.url("Ann Admin", "/impact"),
        params={"action": "leave_department", "from_department_id": org.engineering},
    ).json()
    assert impact["keeps_every_department"] is True
    assert impact["roles_ending"] == []


def test_suspend_and_remove_previews_cover_everything(org: Org, people) -> None:
    org.join(people("Lee Lead"), "team_lead")
    org.owner.post(org.url("Lee Lead", "/departments"), json={"department_id": org.sales})

    for action in ("suspend", "remove"):
        impact = org.owner.get(org.url("Lee Lead", "/impact"), params={"action": action}).json()
        assert {d["name"] for d in impact["departments_losing"]} == {"Engineering", "Sales"}
        assert impact["departments_keeping"] == []
        assert {role["key"] for role in impact["roles_ending"]} == {"member", "team_lead"}


def test_another_manager_means_no_warning(org: Org, people) -> None:
    org.join(people("Max Manager"), "department_manager")
    org.join(people("Nia Manager"), "department_manager")
    impact = org.owner.get(org.url("Max Manager", "/impact"), params={"action": "remove"}).json()
    assert impact["sole_manager_of"] == []
    assert impact["pending_requests"] == 0


def test_suspended_manager_does_not_count_as_cover(org: Org, people) -> None:
    org.join(people("Max Manager"), "department_manager")
    org.join(people("Nia Manager"), "department_manager")
    org.owner.post(org.url("Nia Manager", "/suspend"), json={})
    impact = org.owner.get(org.url("Max Manager", "/impact"), params={"action": "remove"}).json()
    assert [d["name"] for d in impact["sole_manager_of"]] == ["Engineering"]


def test_preview_refuses_what_the_action_would_refuse(org: Org, people) -> None:
    admin = people("Ann Admin")
    org.join(admin, "admin")
    org.join(people("Mia Member"))

    protected = admin.get(org.url("Olivia Owner", "/impact"), params={"action": "remove"})
    assert protected.status_code == 403 and error_code(protected) == "owner_protected"
    missing = org.owner.get(org.url("Mia Member", "/impact"), params={"action": "transfer"})
    assert missing.status_code == 422
    wrong = org.owner.get(
        org.url("Mia Member", "/impact"),
        params={
            "action": "transfer",
            "from_department_id": org.sales,
            "to_department_id": org.support,
        },
    )
    assert wrong.status_code == 422
    unknown = org.owner.get(org.url("Mia Member", "/impact"), params={"action": "make_owner"})
    assert unknown.status_code == 422


# --- Ownership -------------------------------------------------------------------------------


def transfer_ownership(org: Org, name: str, client: ApiClient | None = None, password=None):
    return (client or org.owner).post(
        f"{org.base}/ownership-transfer",
        json={
            "membership_id": org.member(name)["membership_id"],
            "password": password or DEFAULT_PASSWORD,
        },
    )


def owner_count(db: Session, organization_id: int) -> int:
    db.rollback()
    return (
        db.scalar(
            select(func.count())
            .select_from(MembershipRole)
            .join(Role, Role.id == MembershipRole.role_id)
            .join(OrganizationMembership, OrganizationMembership.id == MembershipRole.membership_id)
            .where(Role.key == "owner", OrganizationMembership.organization_id == organization_id)
        )
        or 0
    )


def test_ownership_transfer_swaps_owner_and_admin(org: Org, people, db: Session) -> None:
    successor = people("Sam Successor")
    org.join(successor, "team_lead")

    assert transfer_ownership(org, "Sam Successor").status_code == 204

    assert owner_count(db, org.id) == 1
    assert role_keys(org.member("Sam Successor")) == {
        ("owner", None),
        ("team_lead", org.engineering),
    }
    assert role_keys(org.member("Olivia Owner")) == {("admin", None)}
    entry = audit_rows(db, "organization.ownership_transferred")[0]
    assert entry.details["user_name"] == "Sam Successor"
    assert entry.details["previous_owner_name"] == "Olivia Owner"

    # The new Owner is now protected from the old one, and can manage them.
    protected = org.owner.post(org.url("Sam Successor", "/suspend"), json={})
    assert protected.status_code == 403 and error_code(protected) == "owner_protected"
    again = transfer_ownership(org, "Olivia Owner", org.owner)
    assert again.status_code == 403
    demoted = successor.patch(
        org.url("Olivia Owner", "/roles"), json={"organization_role": "member"}
    )
    assert demoted.status_code == 200


def test_ownership_needs_the_right_password(org: Org, people, db: Session) -> None:
    org.join(people("Sam Successor"))
    response = transfer_ownership(org, "Sam Successor", password="not my password")
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "password"
    assert ("owner", None) in role_keys(org.member("Olivia Owner"))
    assert owner_count(db, org.id) == 1


def test_ownership_attempts_are_rate_limited(org: Org, people) -> None:
    org.join(people("Sam Successor"))
    for _ in range(10):
        assert transfer_ownership(org, "Sam Successor", password="wrong").status_code == 422
    limited = transfer_ownership(org, "Sam Successor")
    assert limited.status_code == 429
    assert ("owner", None) in role_keys(org.member("Olivia Owner"))


def test_ownership_cannot_go_to_yourself_or_a_suspended_member(org: Org, people) -> None:
    org.join(people("Sam Successor"))
    own = transfer_ownership(org, "Olivia Owner")
    assert own.status_code == 403 and error_code(own) == "own_membership"

    org.owner.post(org.url("Sam Successor", "/suspend"), json={})
    suspended = transfer_ownership(org, "Sam Successor")
    assert suspended.status_code == 409 and error_code(suspended) == "member_state"


def test_ownership_transfer_is_all_or_nothing(org: Org, people, db: Session) -> None:
    org.join(people("Sam Successor"))
    with patch("app.modules.memberships.management.audit.record", side_effect=RuntimeError("boom")):
        response = transfer_ownership(org, "Sam Successor")

    assert response.status_code == 500
    assert owner_count(db, org.id) == 1
    assert ("owner", None) in role_keys(org.member("Olivia Owner"))
