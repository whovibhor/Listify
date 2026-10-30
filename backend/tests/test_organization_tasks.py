from typing import Any
from unittest.mock import patch

import pytest
from argon2 import PasswordHasher
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.modules.audit_logs.models import AuditLog
from app.modules.tasks.models import Task, TaskActivity, TaskStatus, WorkspaceType
from tests.conftest import ApiClient
from tests.factories import (
    create_org,
    create_task,
    departments_of,
    join_as,
    list_tasks,
    register,
)


@pytest.fixture(autouse=True)
def cheap_password_hashing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Most tests here sign up a whole team; real Argon2 costs would take minutes."""
    monkeypatch.setattr(
        "app.modules.auth.passwords._hasher",
        PasswordHasher(time_cost=1, memory_cost=8, parallelism=1),
    )


class Team:
    """An organization with people in known roles: Eng and Sales departments, plus an outsider.

    `admin`, `manager` and `lead` are Eng; `eng` and `eng2` are Eng members; `sales` is in Sales.
    """

    def __init__(self, owner: ApiClient, person, *, review_required: bool = False) -> None:
        self.owner = owner
        self.person = person
        self.org = create_org(owner)
        self.id: int = self.org["id"]
        self.base = f"/api/v1/organizations/{self.id}"
        owner.patch(self.base, json={"review_required": review_required})
        departments = departments_of(owner, self.id)
        self.engineering = departments["Engineering"]
        self.sales_department = departments["Sales"]
        self.admin = self.join("Ann Admin", "admin")
        self.manager = self.join("Max Manager", "department_manager")
        self.lead = self.join("Lee Lead", "team_lead")
        self.eng = self.join("Eve Eng")
        self.eng2 = self.join("Ed Eng")
        self.sales = self.join("Sam Sales", department=self.sales_department)
        self.ids = {
            member["name"]: member["user_id"]
            for member in owner.get(f"{self.base}/members", params={"page_size": 100}).json()[
                "items"
            ]
        }
        self.membership_ids = {
            member["name"]: member["membership_id"]
            for member in owner.get(f"{self.base}/members", params={"page_size": 100}).json()[
                "items"
            ]
        }

    def join(self, name: str, role: str = "member", *, department: int | None = None) -> ApiClient:
        client = self.person(name)
        join_as(self.owner, client, self.id, department or self.engineering, role_key=role)
        return client

    def create(self, client: ApiClient | None = None, title: str = "Ship it", **fields: Any):
        response = (client or self.owner).post(
            f"{self.base}/tasks", json={"title": title, **fields}
        )
        assert response.status_code == 201, response.text
        return response.json()

    def eng_task(self, client: ApiClient | None = None, **fields: Any) -> dict[str, Any]:
        return self.create(client, department_id=self.engineering, **fields)

    def titles(self, client: ApiClient, **params: Any) -> set[str]:
        response = client.get(f"{self.base}/tasks", params=params)
        assert response.status_code == 200, response.text
        return {task["title"] for task in response.json()["items"]}

    def board(self, client: ApiClient, department_id: int | None = None, **params: Any):
        return client.get(
            f"{self.base}/departments/{department_id or self.engineering}/board", params=params
        )

    def board_titles(self, client: ApiClient, **params: Any) -> set[str]:
        response = self.board(client, **params)
        assert response.status_code == 200, response.text
        return {task["title"] for column in response.json()["columns"] for task in column["items"]}


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


@pytest.fixture
def team(owner: ApiClient, person) -> Team:
    return Team(owner, person)


def code(response: Any) -> str:
    return response.json()["error"]["code"]


def task_url(task: dict[str, Any], suffix: str = "") -> str:
    return f"/api/v1/tasks/{task['id']}{suffix}"


# --- Visibility ------------------------------------------------------------------------------

# Who can read a task of each visibility, for a task in Engineering created by `eng`, assigned to
# `eng2`, with `sales` as a collaborator. `selected` is shared with `lead`.
ON_THE_TASK = {"eng", "eng2", "sales"}
ADMINS = {"owner", "admin"}
ENGINEERING = {"manager", "lead"}
VISIBILITY_CASES = {
    "private": ON_THE_TASK | ADMINS,
    "department": ON_THE_TASK | ADMINS | ENGINEERING,
    "selected": ON_THE_TASK | ADMINS | {"lead"},
    "organization": ON_THE_TASK | ADMINS | ENGINEERING | {"other_department"},
}
ACTORS = ("owner", "admin", "manager", "lead", "eng", "eng2", "sales", "other_department")


@pytest.mark.parametrize("visibility", VISIBILITY_CASES)
def test_visibility_matrix(team: Team, visibility: str) -> None:
    other_department = team.join("Oli Other", department=team.sales_department)
    fields: dict[str, Any] = {}
    if visibility == "selected":
        fields["visible_to"] = [team.ids["Lee Lead"]]
    task = team.create(
        team.eng,
        title="Secret plan",
        department_id=team.engineering,
        assigned_to=team.ids["Ed Eng"],
        collaborator_ids=[team.ids["Sam Sales"]],
    )
    # Only an administrator may share with everyone, so `owner` sets the visibility.
    response = team.owner.patch(task_url(task), json={"visibility": visibility, **fields})
    assert response.status_code == 200, response.text

    actors = {
        "owner": team.owner,
        "admin": team.admin,
        "manager": team.manager,
        "lead": team.lead,
        "eng": team.eng,
        "eng2": team.eng2,
        "sales": team.sales,
        "other_department": other_department,
    }
    for name in ACTORS:
        client = actors[name]
        allowed = name in VISIBILITY_CASES[visibility]
        # Reading, listing and searching all agree.
        assert client.get(task_url(task)).status_code == (200 if allowed else 404), name
        assert ("Secret plan" in team.titles(client)) is allowed, name
        assert ("Secret plan" in team.titles(client, q="Secret")) is allowed, name


def test_private_task_hidden_on_board(team: Team) -> None:
    team.eng_task(team.eng, title="Mine alone", visibility="private")
    team.eng_task(team.eng, title="For the team")

    assert team.board_titles(team.eng2) == {"For the team"}
    assert team.board_titles(team.eng) == {"Mine alone", "For the team"}
    assert team.board_titles(team.admin) == {"Mine alone", "For the team"}


def test_selected_users_can_read_but_not_change(team: Team) -> None:
    task = team.eng_task(
        team.eng, visibility="selected", visible_to=[team.ids["Sam Sales"], team.ids["Ed Eng"]]
    )
    assert team.sales.get(task_url(task)).json()["actions"] == []
    assert team.sales.patch(task_url(task), json={"title": "Mine now"}).status_code == 403
    assert {person["name"] for person in team.eng.get(task_url(task)).json()["visible_to"]} == {
        "Sam Sales",
        "Ed Eng",
    }


def test_changing_visibility_drops_the_people_it_was_shared_with(team: Team) -> None:
    task = team.eng_task(team.eng, visibility="selected", visible_to=[team.ids["Sam Sales"]])
    assert team.sales.get(task_url(task)).status_code == 200

    team.eng.patch(task_url(task), json={"visibility": "private"})

    assert team.sales.get(task_url(task)).status_code == 404
    assert team.eng.get(task_url(task)).json()["visible_to"] == []


@pytest.mark.parametrize(
    ("fields", "field"),
    [
        ({"visibility": "department"}, "visibility"),
        ({"visibility": "selected"}, "visible_to"),
    ],
)
def test_visibility_needs_what_it_refers_to(team: Team, fields: dict[str, Any], field: str) -> None:
    response = team.owner.post(f"{team.base}/tasks", json={"title": "x", **fields})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == field


def test_only_administrators_share_with_the_whole_organization(team: Team) -> None:
    for client in (team.manager, team.lead, team.eng):
        response = client.post(
            f"{team.base}/tasks",
            json={"title": "x", "department_id": team.engineering, "visibility": "organization"},
        )
        assert response.status_code == 403
    team.eng_task(team.admin, title="Everyone", visibility="organization")
    assert "Everyone" in team.titles(team.sales)


def test_the_default_visibility_suits_the_scope(team: Team) -> None:
    assert team.eng_task(team.eng)["visibility"] == "department"
    assert team.create(team.eng)["visibility"] == "private"


# --- Boards ----------------------------------------------------------------------------------


def test_board_access_denied_non_member(team: Team, person) -> None:
    stranger = person("Sue Stranger")
    assert team.board(stranger).status_code == 404
    assert team.board(team.sales).status_code == 404
    assert team.board(team.eng).status_code == 200
    assert team.board(team.admin).status_code == 200


def test_collaborator_cannot_list_board(team: Team) -> None:
    task = team.eng_task(team.owner, title="Shared", collaborator_ids=[team.ids["Sam Sales"]])
    team.eng_task(team.owner, title="Not shared")

    assert team.sales.get(task_url(task)).status_code == 200
    assert team.board(team.sales).status_code == 404
    assert team.titles(team.sales) == {"Shared"}


def test_board_groups_by_status_and_filters(team: Team) -> None:
    first = team.eng_task(title="Started", priority="urgent", assigned_to=team.ids["Eve Eng"])
    team.owner.patch(task_url(first), json={"status": "in_progress"})
    team.eng_task(title="Waiting", assigned_to=team.ids["Ed Eng"])

    board = team.board(team.eng).json()
    columns = {column["status"]: column for column in board["columns"]}
    assert list(columns) == [status.value for status in TaskStatus]
    assert [task["title"] for task in columns["in_progress"]["items"]] == ["Started"]
    assert columns["not_started"]["total"] == 1
    assert board["department"]["name"] == "Engineering"
    assert board["can_create"] is True

    assert team.board_titles(team.eng, assignee=team.ids["Ed Eng"]) == {"Waiting"}
    assert team.board_titles(team.eng, priority="urgent") == {"Started"}
    assert team.board_titles(team.eng, q="Wait") == {"Waiting"}
    assert team.board_titles(team.eng, creator=team.ids["Olivia Owner"]) == {"Started", "Waiting"}


def test_other_organizations_stay_out(team: Team, person) -> None:
    rival = person("Rita Rival")
    other = create_org(rival, "Rival Inc")
    other_department = departments_of(rival, other["id"])["Engineering"]
    task = team.eng_task(title="Ours")

    assert rival.get(task_url(task)).status_code == 404
    assert rival.patch(task_url(task), json={"title": "Theirs"}).status_code == 404
    assert rival.get(f"{team.base}/tasks").status_code == 404
    # Another organization's department doesn't exist here, for anyone.
    response = team.owner.post(
        f"{team.base}/tasks", json={"title": "x", "department_id": other_department}
    )
    assert response.status_code == 404
    assert team.board(team.owner, other_department).status_code == 404


# --- Creating --------------------------------------------------------------------------------


def test_task_department_must_belong_to_org_and_to_the_creator(team: Team) -> None:
    response = team.eng.post(
        f"{team.base}/tasks", json={"title": "x", "department_id": team.sales_department}
    )
    assert response.status_code == 404
    assert team.create(team.admin, department_id=team.sales_department)["department"] == {
        "id": team.sales_department,
        "name": "Sales",
    }


def test_archived_department_blocks_new_tasks_but_keeps_old_ones(team: Team) -> None:
    team.eng_task(team.eng, title="Before")
    team.owner.post(f"{team.base}/departments/{team.engineering}/archive")

    response = team.owner.post(
        f"{team.base}/tasks", json={"title": "After", "department_id": team.engineering}
    )

    assert response.status_code == 422
    board = team.board(team.owner).json()
    assert board["archived"] is True and board["can_create"] is False
    assert team.board_titles(team.owner) == {"Before"}


def test_task_roles_distinct(team: Team) -> None:
    task = team.eng_task(
        team.eng,
        assigned_to=team.ids["Ed Eng"],
        collaborator_ids=[team.ids["Lee Lead"]],
    )
    assert task["creator"]["name"] == "Eve Eng"
    assert task["assignee"]["name"] == "Ed Eng"
    assert [person["name"] for person in task["collaborators"]] == ["Lee Lead"]

    both = team.eng.post(
        f"{team.base}/tasks",
        json={
            "title": "x",
            "assigned_to": team.ids["Eve Eng"],
            "collaborator_ids": [team.ids["Eve Eng"]],
        },
    )
    assert both.status_code == 422

    # Becoming the assignee replaces being a collaborator.
    updated = team.eng.patch(task_url(task), json={"assigned_to": team.ids["Lee Lead"]}).json()
    assert updated["assignee"]["name"] == "Lee Lead"
    assert updated["collaborators"] == []


def test_assign_suspended_member_rejected(team: Team) -> None:
    team.owner.post(f"{team.base}/members/{team.membership_ids['Ed Eng']}/suspend", json={})
    response = team.owner.post(
        f"{team.base}/tasks",
        json={
            "title": "x",
            "department_id": team.engineering,
            "assigned_to": team.ids["Ed Eng"],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "assigned_to"


def test_assign_requires_active_member_of_the_department(team: Team, person) -> None:
    stranger = person("Sue Stranger")
    stranger_id = stranger.get("/api/v1/me").json()["id"]
    for user_id in (stranger_id, team.ids["Sam Sales"]):
        response = team.owner.post(
            f"{team.base}/tasks",
            json={"title": "x", "department_id": team.engineering, "assigned_to": user_id},
        )
        assert response.status_code == 422
    # Without a department, anyone active can take it.
    assert team.create(assigned_to=team.ids["Sam Sales"])["assignee"]["name"] == "Sam Sales"


def test_collaborators_must_be_active_members_but_can_be_from_anywhere(team: Team, person) -> None:
    stranger_id = person("Sue Stranger").get("/api/v1/me").json()["id"]
    task = team.eng_task(team.owner)
    added = team.owner.post(
        task_url(task, "/collaborators"), json={"user_id": team.ids["Sam Sales"]}
    )
    assert [person["name"] for person in added.json()["collaborators"]] == ["Sam Sales"]
    refused = team.owner.post(task_url(task, "/collaborators"), json={"user_id": stranger_id})
    assert refused.status_code == 422


def test_creating_a_task_is_all_or_nothing(team: Team, db: Session) -> None:
    with patch("app.modules.tasks.organization.service.record", side_effect=RuntimeError("boom")):
        response = team.owner.post(
            f"{team.base}/tasks", json={"title": "x", "collaborator_ids": [team.ids["Eve Eng"]]}
        )
    assert response.status_code == 500
    assert db.scalars(select(Task)).all() == []


def test_the_database_refuses_a_task_with_mixed_scope(team: Team, db: Session) -> None:
    user_id = team.ids["Olivia Owner"]
    db.add(
        Task(
            workspace_type=WorkspaceType.ORGANIZATION,
            owner_user_id=user_id,
            organization_id=team.id,
            created_by=user_id,
            title="Both",
        )
    )
    # MySQL reports CHECK violations as operational errors.
    with pytest.raises(OperationalError, match="ck_tasks_organization_scope"):
        db.commit()
    db.rollback()


# --- Dates, tags, subtasks -------------------------------------------------------------------


def test_deadlines_use_the_organization_timezone(team: Team) -> None:
    """The owner's profile says Kolkata, but organization work runs on organization time."""
    team.owner.patch(team.base, json={"timezone": "America/New_York"})
    task = team.create(due_date="2026-12-01")
    assert task["due_at"].startswith("2026-12-02T04:59:59")


def test_tags_belong_to_the_organization(team: Team) -> None:
    response = team.eng.post(f"{team.base}/tags", json={"name": "urgent-fix", "color": "red"})
    assert response.status_code == 201, response.text
    tag = response.json()
    personal = team.eng.post("/api/v1/me/tags", json={"name": "mine"}).json()

    assert [t["name"] for t in team.sales.get(f"{team.base}/tags").json()] == ["urgent-fix"]
    assert team.eng.get("/api/v1/me/tags").json() == [personal]
    task = team.eng_task(team.eng, title="Tagged", tag_ids=[tag["id"]])
    assert [t["name"] for t in task["tags"]] == ["urgent-fix"]
    assert team.titles(team.eng, tag=tag["id"]) == {"Tagged"}

    # Personal tags can't cross into organization work, or the reverse.
    assert (
        team.eng.post(f"{team.base}/tasks", json={"title": "x", "tag_ids": [personal["id"]]})
    ).status_code == 422
    assert (
        team.eng.post("/api/v1/me/tasks", json={"title": "x", "tag_ids": [tag["id"]]})
    ).status_code == 422

    duplicate = team.eng.post(f"{team.base}/tags", json={"name": "URGENT-FIX"})
    assert duplicate.status_code == 409 and code(duplicate) == "tag_name_taken"
    assert team.eng.delete(f"{team.base}/tags/{tag['id']}").status_code == 403
    assert team.admin.delete(f"{team.base}/tags/{tag['id']}").status_code == 204


def test_subtasks_follow_their_parents_access(team: Team) -> None:
    parent = team.eng_task(team.eng, title="Parent", visibility="private")
    response = team.eng.post(
        f"{team.base}/tasks", json={"title": "Step 1", "parent_task_id": parent["id"]}
    )
    assert response.status_code == 201, response.text
    subtask = response.json()

    assert team.eng2.get(task_url(subtask)).status_code == 404
    team.eng.patch(task_url(parent), json={"visibility": "department"})
    assert team.eng2.get(task_url(subtask)).status_code == 200
    assert team.board_titles(team.eng) == {"Parent"}
    assert team.titles(team.eng, q="Step") == set()

    done = team.eng.post(task_url(subtask, "/complete"))
    assert done.status_code == 200, done.text
    assert team.eng.delete(task_url(subtask)).status_code == 204
    refused = team.eng2.post(
        f"{team.base}/tasks", json={"title": "Nope", "parent_task_id": parent["id"]}
    )
    assert refused.status_code == 403


# --- Who can change what ---------------------------------------------------------------------


def test_edit_rights(team: Team) -> None:
    task = team.eng_task(team.eng, assigned_to=team.ids["Ed Eng"])
    can_edit = [team.eng, team.eng2, team.lead, team.manager, team.admin, team.owner]
    for client in can_edit:
        assert client.patch(task_url(task), json={"priority": "high"}).status_code == 200

    bystander = team.join("Bea Bystander")
    assert bystander.get(task_url(task)).status_code == 200
    assert bystander.patch(task_url(task), json={"priority": "low"}).status_code == 403
    assert bystander.post(task_url(task, "/complete")).status_code == 403
    assert bystander.get(task_url(task)).json()["allowed_statuses"] == []


def test_collaborators_can_edit_but_not_reassign(team: Team) -> None:
    task = team.eng_task(team.owner, collaborator_ids=[team.ids["Sam Sales"]])
    assert team.sales.patch(task_url(task), json={"priority": "high"}).status_code == 200
    response = team.sales.patch(task_url(task), json={"assigned_to": team.ids["Eve Eng"]})
    assert response.status_code == 403


def test_assignment_rights(team: Team) -> None:
    own = team.eng_task(team.eng, assigned_to=team.ids["Ed Eng"])
    # The creator may reassign their own task (PRD: "manager, creator or task owner").
    assert (
        team.eng.patch(task_url(own), json={"assigned_to": team.ids["Lee Lead"]}).status_code == 200
    )
    theirs = team.eng_task(team.owner, assigned_to=team.ids["Eve Eng"])
    assert (
        team.eng2.patch(task_url(theirs), json={"assigned_to": team.ids["Ed Eng"]}).status_code
        == 403
    )
    assert (
        team.lead.patch(task_url(theirs), json={"assigned_to": team.ids["Ed Eng"]}).status_code
        == 200
    )


def test_anyone_who_sees_an_unassigned_task_can_pick_it_up(team: Team) -> None:
    task = team.eng_task(team.owner)
    picked = team.eng2.patch(task_url(task), json={"assigned_to": team.ids["Ed Eng"]})
    assert picked.status_code == 200, picked.text
    assert picked.json()["assignee"]["name"] == "Ed Eng"
    # Once taken, it can't be taken again.
    assert (
        team.eng.patch(task_url(task), json={"assigned_to": team.ids["Eve Eng"]}).status_code == 403
    )


def test_collaborator_management_rights(team: Team) -> None:
    task = team.eng_task(team.owner)
    url = task_url(task, "/collaborators")
    assert team.eng.post(url, json={"user_id": team.ids["Sam Sales"]}).status_code == 403
    assert team.lead.post(url, json={"user_id": team.ids["Sam Sales"]}).status_code == 200
    # Anyone can step off a task themselves.
    assert team.sales.delete(f"{url}/{team.ids['Sam Sales']}").status_code == 200
    assert team.sales.get(task_url(task)).status_code == 404
    assert team.owner.delete(f"{url}/{team.ids['Sam Sales']}").status_code == 404


def test_archive_keeps_the_task_and_writes_the_audit_log(team: Team, db: Session) -> None:
    task = team.eng_task(team.eng, title="Old news")
    assert team.eng2.post(task_url(task, "/archive")).status_code == 403
    assert team.lead.post(task_url(task, "/archive")).status_code == 403
    assert team.manager.post(task_url(task, "/archive")).status_code == 200

    assert "Old news" not in team.titles(team.eng)
    assert team.titles(team.eng, view="archived") == {"Old news"}
    db.rollback()
    assert db.scalar(select(AuditLog).where(AuditLog.action == "task.archived")) is not None


def test_organization_tasks_cannot_be_deleted(team: Team) -> None:
    task = team.eng_task(team.owner)
    response = team.owner.delete(task_url(task))
    assert response.status_code == 409 and code(response) == "archive_instead"
    assert team.owner.get(task_url(task)).status_code == 200


def test_personal_tasks_refuse_organization_fields(team: Team) -> None:
    task = create_task(team.eng, "Private errand")
    response = team.eng.patch(task_url(task), json={"visibility": "organization"})
    assert response.status_code == 422
    assert (
        team.eng.post(
            task_url(task, "/collaborators"), json={"user_id": team.ids["Ed Eng"]}
        ).status_code
        == 422
    )


def test_personal_and_organization_tasks_never_mix(team: Team) -> None:
    create_task(team.eng, "Private errand")
    team.eng_task(team.eng, title="Team work", assigned_to=team.ids["Eve Eng"])

    assert [task["title"] for task in list_tasks(team.eng)["items"]] == ["Private errand"]
    assert team.titles(team.eng) == {"Team work"}
    assert team.titles(team.admin) == {"Team work"}


# --- Views -----------------------------------------------------------------------------------


def test_my_work_and_collaborating_views(team: Team) -> None:
    team.eng_task(title="Assigned", assigned_to=team.ids["Eve Eng"])
    team.eng_task(title="Helping", collaborator_ids=[team.ids["Eve Eng"]])
    finished = team.eng_task(title="Finished", assigned_to=team.ids["Eve Eng"])
    team.owner.post(task_url(finished, "/complete"))
    team.eng_task(title="Someone else's", assigned_to=team.ids["Ed Eng"])

    assert team.titles(team.eng, view="my_work") == {"Assigned"}
    assert team.titles(team.eng, view="my_work", status="completed") == {"Finished"}
    assert team.titles(team.eng, view="collaborating") == {"Helping"}
    assert len(team.titles(team.eng)) == 4


def test_team_filters(team: Team) -> None:
    team.eng_task(title="Unowned", due_date="2030-06-15")
    team.eng_task(title="Owned", assigned_to=team.ids["Ed Eng"], due_date="2030-07-01")
    team.create(team.sales, title="Sales work")

    assert team.titles(team.owner, unassigned="true", department_id=team.engineering) == {"Unowned"}
    assert team.titles(team.owner, assignee=team.ids["Ed Eng"]) == {"Owned"}
    assert team.titles(team.owner, due_from="2030-06-01", due_to="2030-06-30") == {"Unowned"}
    assert team.titles(team.owner, creator=team.ids["Sam Sales"]) == {"Sales work"}


def test_search_treats_wildcards_literally(team: Team) -> None:
    team.eng_task(title="50% done")
    team.eng_task(title="All done")
    assert team.titles(team.eng, q="%") == {"50% done"}


# --- Moving between departments --------------------------------------------------------------


def test_moving_a_task_recalculates_access_and_is_audited(team: Team, db: Session) -> None:
    task = team.eng_task(team.owner, title="Moving")
    assert team.board_titles(team.eng) == {"Moving"}

    response = team.owner.patch(task_url(task), json={"department_id": team.sales_department})

    assert response.status_code == 200, response.text
    assert team.eng.get(task_url(task)).status_code == 404
    assert team.board_titles(team.eng) == set()
    assert team.sales.get(task_url(task)).status_code == 200
    db.rollback()
    entry = db.scalar(select(AuditLog).where(AuditLog.action == "task.moved"))
    assert entry is not None
    assert entry.details["from_department"] == "Engineering"
    assert entry.details["to_department"] == "Sales"
    assert db.scalar(select(TaskActivity).where(TaskActivity.event_type == "moved")) is not None


def test_only_managers_of_both_departments_can_move(team: Team) -> None:
    task = team.eng_task(team.eng)
    target = {"department_id": team.sales_department}
    # The creator can't move it: it's a decision about the department, not the task.
    assert team.eng.patch(task_url(task), json=target).status_code == 403
    # A manager can't reach a department they aren't in.
    assert team.manager.patch(task_url(task), json=target).status_code == 404


def test_task_with_department_visibility_needs_a_department(team: Team) -> None:
    task = team.eng_task(team.owner)
    response = team.owner.patch(task_url(task), json={"department_id": None})
    assert response.status_code == 422
    done = team.owner.patch(task_url(task), json={"department_id": None, "visibility": "private"})
    assert done.status_code == 200, done.text


def test_completion_keeps_the_department_it_happened_in(team: Team, db: Session) -> None:
    task = team.eng_task(team.owner)
    team.owner.post(task_url(task, "/complete"))
    team.owner.patch(task_url(task), json={"department_id": team.sales_department})

    db.rollback()
    row = db.get(Task, task["id"])
    assert row is not None
    assert row.completed_department_id == team.engineering
    assert row.department_id == team.sales_department

    team.owner.post(task_url(task, "/reopen"))
    db.rollback()
    db.expire_all()
    assert db.get(Task, task["id"]).completed_department_id is None


# --- Review ----------------------------------------------------------------------------------


@pytest.fixture
def reviewed(owner: ApiClient, person) -> Team:
    return Team(owner, person, review_required=True)


def test_review_required_routes_work_through_review(reviewed: Team) -> None:
    task = reviewed.eng_task(reviewed.manager, assigned_to=reviewed.ids["Eve Eng"])
    assert reviewed.eng.post(task_url(task, "/complete")).status_code == 409

    assert reviewed.eng.patch(task_url(task), json={"status": "in_progress"}).status_code == 200
    moved = reviewed.eng.patch(task_url(task), json={"status": "in_review"})
    assert moved.status_code == 200, moved.text
    # The assignee can't approve their own work; the creator can.
    assert "completed" not in moved.json()["allowed_statuses"]
    assert reviewed.eng.post(task_url(task, "/complete")).status_code == 403
    assert "completed" in reviewed.manager.get(task_url(task)).json()["allowed_statuses"]
    assert reviewed.manager.post(task_url(task, "/complete")).status_code == 200


def test_without_review_there_is_no_review_step(team: Team) -> None:
    task = team.eng_task(team.owner)
    team.owner.patch(task_url(task), json={"status": "in_progress"})
    assert team.owner.patch(task_url(task), json={"status": "in_review"}).status_code == 409


# --- People leaving --------------------------------------------------------------------------


def test_suspending_an_assignee_flags_their_tasks_without_touching_them(team: Team) -> None:
    task = team.eng_task(team.owner, title="Handover", assigned_to=team.ids["Eve Eng"])
    done = team.eng_task(team.owner, title="Done", assigned_to=team.ids["Eve Eng"])
    team.owner.post(task_url(done, "/complete"))
    member_url = f"{team.base}/members/{team.membership_ids['Eve Eng']}"

    impact = team.owner.get(f"{member_url}/impact", params={"action": "suspend"}).json()
    assert impact["tasks_to_reassign"] == 1

    team.owner.post(f"{member_url}/suspend", json={})

    flagged = team.owner.get(task_url(task)).json()
    assert flagged["needs_reassignment"] is True
    assert flagged["assignee"]["name"] == "Eve Eng"
    assert team.titles(team.owner, needs_reassignment="true") == {"Handover"}
    assert team.eng.get(task_url(task)).status_code == 404

    # Reassigning clears the flag; so would reactivating them.
    team.owner.patch(task_url(task), json={"assigned_to": team.ids["Ed Eng"]})
    assert team.owner.get(task_url(task)).json()["needs_reassignment"] is False


def test_reactivating_clears_the_flag(team: Team) -> None:
    task = team.eng_task(team.owner, assigned_to=team.ids["Eve Eng"])
    member_url = f"{team.base}/members/{team.membership_ids['Eve Eng']}"
    team.owner.post(f"{member_url}/suspend", json={})
    team.owner.post(f"{member_url}/reactivate")
    assert team.owner.get(task_url(task)).json()["needs_reassignment"] is False


def test_transfer_flags_only_the_old_departments_tasks(team: Team) -> None:
    old = team.eng_task(team.owner, title="Old dept", assigned_to=team.ids["Eve Eng"])
    team.create(title="No dept", assigned_to=team.ids["Eve Eng"])
    member_url = f"{team.base}/members/{team.membership_ids['Eve Eng']}"
    params = {
        "action": "transfer",
        "from_department_id": team.engineering,
        "to_department_id": team.sales_department,
    }

    assert team.owner.get(f"{member_url}/impact", params=params).json()["tasks_to_reassign"] == 1
    team.owner.post(
        f"{member_url}/transfer",
        json={
            "from_department_id": team.engineering,
            "to_department_id": team.sales_department,
        },
    )

    assert team.titles(team.owner, needs_reassignment="true") == {"Old dept"}
    # They keep sight of work still assigned to them, but the department's board is gone.
    assert team.eng.get(task_url(old)).status_code == 200
    assert team.board(team.eng).status_code == 404


def test_removed_member_loses_board(team: Team) -> None:
    team.eng_task(team.owner, title="Work", assigned_to=team.ids["Eve Eng"])
    team.owner.post(f"{team.base}/members/{team.membership_ids['Eve Eng']}/remove", json={})
    assert team.board(team.eng).status_code == 404
    assert team.eng.get(f"{team.base}/tasks").status_code == 404
    assert team.titles(team.owner, needs_reassignment="true") == {"Work"}
