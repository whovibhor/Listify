from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from argon2 import PasswordHasher
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.common.storage import LocalStorage
from app.modules.collaboration import attachments
from app.modules.collaboration.models import TaskAttachment, TaskUpdateRequest
from app.modules.notifications.models import Notification
from app.modules.tasks.models import Task, TaskActivity
from tests.conftest import ApiClient
from tests.factories import (
    create_org,
    create_task,
    departments_of,
    join_as,
    register,
    request_to_join,
)
from tests.test_organization_tasks import Team

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
PDF = b"%PDF-1.7\n" + b"x" * 32


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


@pytest.fixture
def team(owner: ApiClient, person, db: Session) -> Team:
    created = Team(owner, person)
    # Everyone starts with an empty inbox, without the "you were approved" from joining.
    db.execute(delete(Notification))
    db.commit()
    return created


def url(task: dict[str, Any], suffix: str = "") -> str:
    return f"/api/v1/tasks/{task['id']}{suffix}"


def code(response: Any) -> str:
    return response.json()["error"]["code"]


def comment(client: ApiClient, task: dict[str, Any], body: str = "Looks good", **fields: Any):
    return client.post(url(task, "/comments"), json={"body": body, **fields})


def upload(client: ApiClient, task: dict[str, Any], filename: str, content: bytes):
    return client.post(
        url(task, "/attachments"),
        params={"filename": filename},
        content=content,
        headers={"Content-Type": "application/octet-stream"},
    )


def inbox(client: ApiClient, **params: Any) -> list[dict[str, Any]]:
    response = client.get("/api/v1/inbox", params=params)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def types(client: ApiClient, **params: Any) -> list[str]:
    return [item["type"] for item in inbox(client, **params)]


# --- Comments ----------------------------------------------------------------------------------


def test_comment_lifecycle(team: Team) -> None:
    task = team.eng_task(team.eng)
    created = comment(team.eng2, task, "First line\nSecond line")
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["author"]["name"] == "Ed Eng" and body["body"] == "First line\nSecond line"

    edited = team.eng2.patch(f"/api/v1/comments/{body['id']}", json={"body": "Fixed"})
    assert edited.json()["edited"] is True and edited.json()["body"] == "Fixed"

    listed = team.eng.get(url(task, "/comments")).json()
    assert [item["body"] for item in listed] == ["Fixed"]
    assert listed[0]["can_edit"] is False and listed[0]["can_delete"] is False


def test_only_the_author_edits_and_admins_can_only_delete(team: Team) -> None:
    task = team.eng_task(team.eng)
    created = comment(team.eng2, task).json()
    path = f"/api/v1/comments/{created['id']}"

    assert team.eng.patch(path, json={"body": "Hijacked"}).status_code == 403
    assert team.admin.patch(path, json={"body": "Reworded"}).status_code == 403
    assert team.eng.delete(path).status_code == 403
    assert team.lead.delete(path).status_code == 403
    assert team.admin.delete(path).status_code == 204


def test_deleting_hides_the_text_everywhere(team: Team, db: Session) -> None:
    task = team.eng_task(team.eng)
    created = comment(team.eng, task, "Regrettable").json()
    assert team.eng.delete(f"/api/v1/comments/{created['id']}").status_code == 204

    item = team.eng.get(url(task, "/comments")).json()[0]
    assert item["deleted"] is True and item["body"] is None and item["can_delete"] is False
    assert "Regrettable" not in team.owner.get(url(task, "/comments")).text
    assert team.eng.delete(f"/api/v1/comments/{created['id']}").status_code == 404
    db.rollback()
    events = list(db.scalars(select(TaskActivity.event_type)))
    assert "comment_added" in events and "comment_deleted" in events


def test_comments_are_exactly_as_visible_as_their_task(team: Team, person) -> None:
    task = team.eng_task(team.eng, visibility="private")
    created = comment(team.eng, task).json()
    path = f"/api/v1/comments/{created['id']}"
    stranger = person("Sue Stranger")

    for outsider in (team.eng2, stranger):
        assert outsider.get(url(task, "/comments")).status_code == 404
        assert comment(outsider, task).status_code == 404
        assert outsider.patch(path, json={"body": "x"}).status_code == 404
        assert outsider.delete(path).status_code == 404

    # Losing access to a task ends access to its comments, even your own.
    shared = team.eng_task(team.owner)
    mine = comment(team.eng, shared).json()
    team.owner.patch(url(shared), json={"visibility": "private"})
    assert team.eng.patch(f"/api/v1/comments/{mine['id']}", json={"body": "x"}).status_code == 404


def test_read_only_viewers_can_comment(team: Team) -> None:
    task = team.eng_task(team.eng, visibility="selected", visible_to=[team.ids["Sam Sales"]])
    assert comment(team.sales, task).status_code == 201


def test_comments_refuse_archived_tasks_subtasks_and_bad_text(team: Team) -> None:
    task = team.eng_task(team.owner)
    subtask = team.owner.post(
        f"{team.base}/tasks", json={"title": "Step", "parent_task_id": task["id"]}
    ).json()
    assert comment(team.owner, subtask).status_code == 422
    assert comment(team.owner, task, "   ").status_code == 422
    assert comment(team.owner, task, "x" * 5001).status_code == 422
    assert comment(team.owner, task, "null\x00byte").status_code == 422
    team.owner.post(url(task, "/archive"))
    assert comment(team.owner, task).status_code == 409


def test_personal_tasks_can_hold_notes_for_their_owner(team: Team, person) -> None:
    task = create_task(team.eng, "My errand")
    assert comment(team.eng, task, "Note to self").status_code == 201
    assert comment(team.eng2, task).status_code == 404
    assert comment(team.eng, task, mention_user_ids=[team.ids["Ed Eng"]]).status_code == 422


def test_mentions_need_someone_who_can_see_the_task(team: Team) -> None:
    task = team.eng_task(team.eng, visibility="private")
    refused = comment(team.eng, task, mention_user_ids=[team.ids["Ed Eng"]])
    assert refused.status_code == 422

    shared = team.eng_task(team.eng)
    assert comment(team.eng, shared, mention_user_ids=[team.ids["Ed Eng"]]).status_code == 201
    assert types(team.eng2) == ["mention"]


# --- Attachments -------------------------------------------------------------------------------


def test_upload_and_download(team: Team) -> None:
    task = team.eng_task(team.eng)
    created = upload(team.eng, task, "Plan Q4.pdf", PDF)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["filename"] == "Plan Q4.pdf" and body["size_bytes"] == len(PDF)
    assert body["content_type"] == "application/pdf"

    response = team.eng2.get(f"/api/v1/attachments/{body['id']}/download")
    assert response.status_code == 200
    assert response.content == PDF
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "default-src 'none'" in response.headers["content-security-policy"]
    assert [item["filename"] for item in team.eng2.get(url(task, "/attachments")).json()] == [
        "Plan Q4.pdf"
    ]


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        ("page.html", b"<script>alert(1)</script>"),
        ("logo.svg", b"<svg onload=alert(1)>"),
        ("run.exe", b"MZ\x90"),
        ("script.js", b"alert(1)"),
        ("noextension", b"hello"),
        ("disguised.png", b"<script>alert(1)</script>"),
        ("fake.pdf", b"not a pdf"),
        ("fake.jpg", b"GIF89a"),
        ("fake.docx", b"plain text"),
        ("fake.webp", b"RIFF1234NOTWEBP"),
        ("binary.txt", b"abc\x00def"),
        ("latin.csv", b"caf\xe9"),
        ("empty.pdf", b""),
    ],
)
def test_unsafe_or_mismatched_files_are_refused(team: Team, filename: str, content: bytes) -> None:
    task = team.eng_task(team.eng)
    response = upload(team.eng, task, filename, content)
    assert response.status_code == 422
    assert code(response) == "attachment_rejected"


@pytest.mark.parametrize(
    ("filename", "content", "content_type"),
    [
        ("photo.PNG", PNG, "image/png"),
        ("notes.txt", "Café notes".encode(), "text/plain"),
        ("data.csv", b"a,b\n1,2\n", "text/csv"),
        ("report.docx", b"PK\x03\x04rest", "application/vnd.openxmlformats-officedocument."),
        ("image.webp", b"RIFF1234WEBPVP8", "image/webp"),
    ],
)
def test_allowed_files(team: Team, filename: str, content: bytes, content_type: str) -> None:
    response = upload(team.eng, team.eng_task(team.eng), filename, content)
    assert response.status_code == 201, response.text
    assert response.json()["content_type"].startswith(content_type)


def test_the_type_the_browser_claims_is_ignored(team: Team) -> None:
    task = team.eng_task(team.eng)
    response = team.eng.post(
        url(task, "/attachments"),
        params={"filename": "photo.png"},
        content=PNG,
        headers={"Content-Type": "text/html"},
    )
    assert response.json()["content_type"] == "image/png"
    download = team.eng.get(f"/api/v1/attachments/{response.json()['id']}/download")
    assert download.headers["content-type"].startswith("image/png")


@pytest.mark.parametrize(
    ("raw", "stored"),
    [
        ("../../../etc/passwd.txt", "passwd.txt"),
        ("..\\..\\windows\\system.txt", "system.txt"),
        ('quote".txt', "quote_.txt"),
        ("a\r\nX-Evil: 1.txt", "a__X-Evil_ 1.txt"),
    ],
)
def test_filenames_cannot_reach_paths_or_headers(team: Team, raw: str, stored: str) -> None:
    task = team.eng_task(team.eng)
    created = upload(team.eng, task, raw, b"hello")
    assert created.status_code == 201, created.text
    assert created.json()["filename"] == stored
    download = team.eng.get(f"/api/v1/attachments/{created.json()['id']}/download")
    assert "x-evil" not in download.headers


def test_stored_files_use_random_names(team: Team, storage: LocalStorage, db: Session) -> None:
    upload(team.eng, team.eng_task(team.eng), "secret-plan.txt", b"hello")
    db.rollback()
    row = db.scalar(select(TaskAttachment))
    assert row is not None and "secret" not in row.storage_key
    files = [path for path in Path(storage.root).rglob("*") if path.is_file()]
    assert [path.name for path in files] == [row.storage_key]


def test_storage_refuses_a_key_that_is_a_path(storage: LocalStorage) -> None:
    for key in ("../../secret", "..\\evil", "a" * 63, ""):
        with pytest.raises(ValueError, match="Invalid storage key"):
            storage.exists(key)


def test_file_size_limits(team: Team) -> None:
    task = team.eng_task(team.eng)
    fits = PDF + b"x" * (9 * 1024 * 1024)
    assert upload(team.eng, task, "big.pdf", fits).status_code == 201
    too_big = PDF + b"x" * (10 * 1024 * 1024)
    response = upload(team.eng, task, "huge.pdf", too_big)
    assert response.status_code == 413 and code(response) == "payload_too_large"
    # The larger allowance is for uploads only.
    plain = team.eng.post(
        "/api/v1/me/tasks", json={"title": "x", "description": "A" * (2 * 1024 * 1024)}
    )
    assert plain.status_code == 413


def test_a_task_has_an_attachment_limit(team: Team, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(attachments, "MAX_ATTACHMENTS_PER_TASK", 2)
    task = team.eng_task(team.eng)
    assert upload(team.eng, task, "a.txt", b"a").status_code == 201
    assert upload(team.eng, task, "b.txt", b"b").status_code == 201
    response = upload(team.eng, task, "c.txt", b"c")
    assert response.status_code == 409 and code(response) == "too_many_attachments"


def test_every_download_checks_access_again(team: Team, person) -> None:
    task = team.eng_task(team.eng)
    attachment = upload(team.eng, task, "plan.pdf", PDF).json()
    path = f"/api/v1/attachments/{attachment['id']}/download"
    assert team.eng2.get(path).status_code == 200
    assert team.sales.get(path).status_code == 404
    assert person("Sue Stranger").get(path).status_code == 404

    # The same person, the same link: access changed, so the answer changes.
    team.eng.patch(url(task), json={"visibility": "private"})
    assert team.eng2.get(path).status_code == 404
    assert team.eng2.delete(f"/api/v1/attachments/{attachment['id']}").status_code == 404
    assert team.eng2.get(url(task, "/attachments")).status_code == 404


def test_suspended_and_removed_members_cannot_download(team: Team) -> None:
    task = team.eng_task(team.owner, assigned_to=team.ids["Eve Eng"])
    attachment = upload(team.owner, task, "plan.pdf", PDF).json()
    path = f"/api/v1/attachments/{attachment['id']}/download"
    member = f"{team.base}/members/{team.membership_ids['Eve Eng']}"
    assert team.eng.get(path).status_code == 200
    team.owner.post(f"{member}/suspend", json={})
    assert team.eng.get(path).status_code == 404
    team.owner.post(f"{member}/reactivate")
    assert team.eng.get(path).status_code == 200
    team.owner.post(f"{member}/remove", json={})
    assert team.eng.get(path).status_code == 404


def test_only_people_who_can_edit_can_upload(team: Team) -> None:
    task = team.eng_task(team.eng, visibility="selected", visible_to=[team.ids["Sam Sales"]])
    assert upload(team.sales, task, "a.txt", b"a").status_code == 403
    assert upload(team.eng, task, "a.txt", b"a").status_code == 201


def test_deleting_an_attachment_removes_the_file(
    team: Team, storage: LocalStorage, db: Session
) -> None:
    task = team.eng_task(team.eng, assigned_to=team.ids["Ed Eng"])
    mine = upload(team.eng2, task, "a.txt", b"a").json()
    other = upload(team.eng, task, "b.txt", b"b").json()
    db.rollback()
    key = db.get(TaskAttachment, mine["id"]).storage_key
    assert storage.exists(key)

    assert team.eng2.delete(f"/api/v1/attachments/{other['id']}").status_code == 403
    assert team.eng2.delete(f"/api/v1/attachments/{mine['id']}").status_code == 204
    assert not storage.exists(key)
    assert team.eng2.get(f"/api/v1/attachments/{mine['id']}/download").status_code == 404


def test_deleting_a_personal_task_removes_its_files(
    team: Team, storage: LocalStorage, db: Session
) -> None:
    task = create_task(team.eng, "My errand")
    upload(team.eng, task, "a.txt", b"a")
    db.rollback()
    key = db.scalar(select(TaskAttachment.storage_key))
    assert team.eng.delete(url(task)).status_code == 204
    assert not storage.exists(key)


def test_archived_tasks_refuse_files(team: Team) -> None:
    task = team.eng_task(team.owner)
    attachment = upload(team.owner, task, "a.txt", b"a").json()
    team.owner.post(url(task, "/archive"))
    assert upload(team.owner, task, "b.txt", b"b").status_code == 409
    assert team.owner.delete(f"/api/v1/attachments/{attachment['id']}").status_code == 409
    assert team.owner.get(f"/api/v1/attachments/{attachment['id']}/download").status_code == 200


# --- Update requests ---------------------------------------------------------------------------


def ask(client: ApiClient, task: dict[str, Any], recipient: int, **fields: Any):
    return client.post(
        url(task, "/update-requests"),
        json={"recipient_id": recipient, "message": "How is it going?", **fields},
    )


@pytest.fixture
def assigned(team: Team) -> dict[str, Any]:
    return team.eng_task(team.owner, assigned_to=team.ids["Eve Eng"])


def test_update_request_flow(team: Team, assigned: dict[str, Any], db: Session) -> None:
    created = ask(team.lead, assigned, team.ids["Eve Eng"])
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "pending"
    assert created.json()["can_cancel"] is True and created.json()["can_respond"] is False

    assert "update_requested" in types(team.eng)
    pending = team.eng.get("/api/v1/me/update-requests").json()
    assert [item["task_title"] for item in pending] == ["Ship it"]
    assert "in_progress" in pending[0]["allowed_statuses"]
    assert team.eng.get("/api/v1/inbox/summary").json()["pending_update_requests"] == 1

    response = team.eng.post(
        f"/api/v1/update-requests/{created.json()['id']}/respond",
        json={"response_note": "Halfway there", "status": "in_progress"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "responded"
    assert response.json()["response_note"] == "Halfway there"
    assert team.eng.get(url(assigned)).json()["status"] == "in_progress"
    assert types(team.lead) == ["update_responded"]
    assert team.eng.get("/api/v1/me/update-requests").json() == []
    db.rollback()
    events = list(db.scalars(select(TaskActivity.event_type)))
    assert "update_requested" in events and "update_responded" in events


def test_who_can_ask_and_whom(team: Team, assigned: dict[str, Any]) -> None:
    assert ask(team.eng2, assigned, team.ids["Eve Eng"]).status_code == 403
    # Only the people working on it can be asked.
    off_task = ask(team.lead, assigned, team.ids["Ed Eng"])
    assert off_task.status_code == 422
    assert ask(team.lead, assigned, team.ids["Lee Lead"]).status_code == 422
    other_department = ask(team.owner, assigned, team.ids["Sam Sales"])
    assert other_department.status_code == 422

    team.owner.post(url(assigned, "/collaborators"), json={"user_id": team.ids["Sam Sales"]})
    assert ask(team.owner, assigned, team.ids["Sam Sales"]).status_code == 201


def test_one_open_request_per_person_per_task(team: Team, assigned: dict[str, Any]) -> None:
    first = ask(team.lead, assigned, team.ids["Eve Eng"]).json()
    duplicate = ask(team.owner, assigned, team.ids["Eve Eng"])
    assert duplicate.status_code == 409 and code(duplicate) == "update_request_pending"

    team.eng.post(f"/api/v1/update-requests/{first['id']}/respond", json={"response_note": "Done"})
    assert ask(team.lead, assigned, team.ids["Eve Eng"]).status_code == 201


def test_only_the_recipient_responds_and_only_once(team: Team, assigned: dict[str, Any]) -> None:
    request = ask(team.lead, assigned, team.ids["Eve Eng"]).json()
    path = f"/api/v1/update-requests/{request['id']}/respond"
    assert team.lead.post(path, json={"response_note": "Fine"}).status_code == 403
    assert team.owner.post(path, json={"response_note": "Fine"}).status_code == 403
    assert team.sales.post(path, json={"response_note": "Fine"}).status_code == 404
    assert team.eng.post(path, json={"response_note": "Fine"}).status_code == 200
    closed = team.eng.post(path, json={"response_note": "Again"})
    assert closed.status_code == 409 and code(closed) == "update_request_closed"


def test_a_refused_status_change_saves_nothing(team: Team, assigned: dict[str, Any]) -> None:
    request = ask(team.lead, assigned, team.ids["Eve Eng"]).json()
    response = team.eng.post(
        f"/api/v1/update-requests/{request['id']}/respond",
        json={"response_note": "Blocked", "status": "blocked"},
    )
    assert response.status_code == 409
    listed = team.lead.get(url(assigned, "/update-requests")).json()
    assert listed[0]["status"] == "pending" and listed[0]["response_note"] is None


def test_cancelling(team: Team, assigned: dict[str, Any]) -> None:
    request = ask(team.lead, assigned, team.ids["Eve Eng"]).json()
    path = f"/api/v1/update-requests/{request['id']}/cancel"
    assert team.eng.post(path).status_code == 403
    assert team.lead.post(path).json()["status"] == "cancelled"
    assert team.lead.post(path).status_code == 409
    assert "update_cancelled" in types(team.eng)
    assert team.eng.get("/api/v1/me/update-requests").json() == []


def test_a_recipient_who_loses_the_task_cannot_see_the_request(
    team: Team, assigned: dict[str, Any]
) -> None:
    request = ask(team.lead, assigned, team.ids["Eve Eng"]).json()
    team.owner.patch(
        url(assigned), json={"visibility": "private", "assigned_to": team.ids["Ed Eng"]}
    )
    assert team.eng.get("/api/v1/me/update-requests").json() == []
    assert team.eng.get("/api/v1/inbox/summary").json()["pending_update_requests"] == 0
    response = team.eng.post(
        f"/api/v1/update-requests/{request['id']}/respond", json={"response_note": "x"}
    )
    assert response.status_code == 404


def test_removing_someone_closes_requests_waiting_on_them(
    team: Team, assigned: dict[str, Any]
) -> None:
    ask(team.lead, assigned, team.ids["Eve Eng"])
    member = f"{team.base}/members/{team.membership_ids['Eve Eng']}"
    impact = team.owner.get(f"{member}/impact", params={"action": "remove"}).json()
    assert impact["open_update_requests"] == 1

    team.owner.post(f"{member}/remove", json={})

    listed = team.lead.get(url(assigned, "/update-requests")).json()
    assert listed[0]["status"] == "cancelled"


def test_personal_tasks_have_no_update_requests(team: Team) -> None:
    task = create_task(team.eng, "My errand")
    assert ask(team.eng, task, team.ids["Ed Eng"]).status_code == 422


def test_respond_by_uses_the_organization_timezone(team: Team, assigned: dict[str, Any]) -> None:
    team.owner.patch(team.base, json={"timezone": "America/New_York"})
    request = ask(team.lead, assigned, team.ids["Eve Eng"], respond_by="2026-12-01").json()
    assert request["respond_by"].startswith("2026-12-02T04:59:59")


# --- Notifications -----------------------------------------------------------------------------


def test_assignment_and_collaborator_notifications(team: Team) -> None:
    task = team.eng_task(
        team.owner, assigned_to=team.ids["Eve Eng"], collaborator_ids=[team.ids["Ed Eng"]]
    )
    assert types(team.eng) == ["assigned"]
    assert types(team.eng2) == ["collaborator_added"]
    item = inbox(team.eng)[0]
    assert item["task"]["title"] == "Ship it" and item["actor_name"] == "Olivia Owner"

    team.owner.patch(url(task), json={"assigned_to": team.ids["Lee Lead"]})
    assert types(team.lead) == ["assigned"]
    team.owner.post(url(task, "/collaborators"), json={"user_id": team.ids["Sam Sales"]})
    assert types(team.sales) == ["collaborator_added"]


def test_nobody_is_notified_about_their_own_action(team: Team) -> None:
    task = team.eng_task(team.eng, assigned_to=team.ids["Eve Eng"])
    comment(team.eng, task)
    assert types(team.eng) == []


def test_comments_reach_the_people_on_the_task(team: Team) -> None:
    task = team.eng_task(
        team.eng, assigned_to=team.ids["Ed Eng"], collaborator_ids=[team.ids["Lee Lead"]]
    )
    comment(team.owner, task)
    assert "comment" in types(team.eng)
    assert "comment" in types(team.eng2)
    assert "comment" in types(team.lead)
    assert "comment" not in types(team.manager)


def test_people_hear_about_changes_to_their_membership(team: Team, person) -> None:
    applicant = person("Amy Applicant")
    request = request_to_join(applicant, team.id, team.engineering).json()
    team.owner.post(f"{team.base}/membership-requests/{request['id']}/approve", json={})
    assert types(applicant) == ["membership_approved"]
    assert inbox(applicant)[0]["data"]["organization_name"] == "Acme"

    rejected = person("Bob Applicant")
    other = request_to_join(rejected, team.id, team.engineering).json()
    team.owner.post(f"{team.base}/membership-requests/{other['id']}/reject", json={})
    assert types(rejected) == ["membership_rejected"]

    member = f"{team.base}/members/{team.membership_ids['Eve Eng']}"
    team.owner.patch(f"{member}/roles", json={"organization_role": "admin"})
    team.owner.post(
        f"{member}/transfer",
        json={"from_department_id": team.engineering, "to_department_id": team.sales_department},
    )
    team.owner.post(f"{member}/suspend", json={})
    team.owner.post(f"{member}/reactivate")
    team.owner.post(f"{member}/remove", json={})
    assert types(team.eng) == [
        "membership_removed",
        "membership_reactivated",
        "membership_suspended",
        "member_transferred",
        "role_changed",
    ]
    assert inbox(team.eng)[3]["data"]["department"] == "Sales"


def test_a_notification_never_reveals_a_task_after_access_is_lost(team: Team, db: Session) -> None:
    task = team.eng_task(team.owner, title="Confidential merger", assigned_to=team.ids["Eve Eng"])
    assert inbox(team.eng)[0]["task"]["title"] == "Confidential merger"

    team.owner.patch(url(task), json={"visibility": "private", "assigned_to": team.ids["Ed Eng"]})

    response = team.eng.get("/api/v1/inbox")
    item = response.json()["items"][0]
    assert item["accessible"] is False
    assert item["task"] is None and item["actor_name"] is None and item["data"] == {}
    assert item["organization_id"] is None
    assert "Confidential merger" not in response.text

    # Nothing to leak in the first place: the row holds no title.
    db.rollback()
    for row in db.scalars(select(Notification)):
        assert "Confidential" not in str(row.data)


def test_notifications_hide_tasks_from_suspended_members(team: Team) -> None:
    team.eng_task(team.owner, title="Confidential merger", assigned_to=team.ids["Eve Eng"])
    member = f"{team.base}/members/{team.membership_ids['Eve Eng']}"
    team.owner.post(f"{member}/suspend", json={})
    response = team.eng.get("/api/v1/inbox")
    assert "Confidential merger" not in response.text
    hidden = [item for item in response.json()["items"] if item["type"] == "assigned"]
    assert hidden[0]["accessible"] is False


def test_comment_text_is_never_stored_in_a_notification(team: Team, db: Session) -> None:
    task = team.eng_task(team.eng, assigned_to=team.ids["Ed Eng"])
    comment(team.owner, task, "The secret detail")
    response = team.eng2.get("/api/v1/inbox")
    assert "The secret detail" not in response.text
    db.rollback()
    assert "secret" not in str(list(db.scalars(select(Notification.data))))


def test_reading_notifications(team: Team) -> None:
    team.eng_task(team.owner, assigned_to=team.ids["Eve Eng"])
    team.eng_task(team.owner, assigned_to=team.ids["Eve Eng"])
    assert team.eng.get("/api/v1/inbox/summary").json()["unread"] == 2

    first = inbox(team.eng)[0]
    assert team.eng.post(f"/api/v1/notifications/{first['id']}/read").status_code == 204
    assert team.eng.get("/api/v1/inbox/summary").json()["unread"] == 1
    assert len(inbox(team.eng, filter="unread")) == 1

    assert team.eng.post("/api/v1/notifications/read-all").status_code == 204
    assert team.eng.get("/api/v1/inbox/summary").json()["unread"] == 0
    assert inbox(team.eng, filter="unread") == []


def test_inbox_filters(team: Team) -> None:
    task = team.eng_task(team.owner, assigned_to=team.ids["Eve Eng"])
    ask(team.lead, task, team.ids["Eve Eng"])
    comment(team.owner, task)
    assert types(team.eng, filter="assignments") == ["assigned"]
    assert types(team.eng, filter="update_requests") == ["update_requested"]
    assert len(inbox(team.eng)) == 3


def test_one_persons_notifications_are_private(team: Team) -> None:
    team.eng_task(team.owner, assigned_to=team.ids["Eve Eng"])
    mine = inbox(team.eng)[0]
    assert team.eng2.post(f"/api/v1/notifications/{mine['id']}/read").status_code == 404
    assert inbox(team.eng2) == []
    team.eng2.post("/api/v1/notifications/read-all")
    assert team.eng.get("/api/v1/inbox/summary").json()["unread"] == 1


def test_a_failed_notification_does_not_undo_the_change(team: Team, db: Session) -> None:
    with patch("app.modules.notifications.service.Notification", side_effect=RuntimeError("boom")):
        task = team.eng_task(team.owner, title="Still saved", assigned_to=team.ids["Eve Eng"])
    assert team.owner.get(url(task)).json()["title"] == "Still saved"
    db.rollback()
    assert db.scalar(select(Task.title).where(Task.id == task["id"])) == "Still saved"
    assert db.scalars(select(Notification)).all() == []


def test_update_requests_have_a_database_guard(team: Team, assigned: dict[str, Any], db) -> None:
    ask(team.lead, assigned, team.ids["Eve Eng"])
    db.rollback()
    row = db.scalar(select(TaskUpdateRequest))
    assert row is not None and row.pending_recipient_id == team.ids["Eve Eng"]


# --- Inbox per workspace -----------------------------------------------------------------------


def second_organization(team: Team, client: ApiClient) -> int:
    """Puts `client` in another organization, which leaves them one notice there."""
    other_owner = team.person("Oscar Other")
    other = create_org(other_owner, "Other Org", departments=("Ops",))
    join_as(other_owner, client, other["id"], departments_of(other_owner, other["id"])["Ops"])
    return other["id"]


def summary(client: ApiClient, **params: Any) -> dict[str, int]:
    response = client.get("/api/v1/inbox/summary", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_each_organization_has_its_own_inbox(team: Team) -> None:
    other = second_organization(team, team.eng)
    team.eng_task(team.owner, assigned_to=team.ids["Eve Eng"])

    assert types(team.eng, workspace=team.id) == ["assigned"]
    assert types(team.eng, workspace=other) == ["membership_approved"]
    assert types(team.eng, workspace="personal") == []
    assert sorted(types(team.eng)) == ["assigned", "membership_approved"]


def test_counts_cover_the_workspace_and_say_what_waits_elsewhere(team: Team) -> None:
    other = second_organization(team, team.eng)
    task = team.eng_task(team.owner, assigned_to=team.ids["Eve Eng"])
    ask(team.lead, task, team.ids["Eve Eng"])

    assert summary(team.eng, workspace=team.id) == {
        "unread": 2,
        "pending_update_requests": 1,
        "other_workspaces": 1,
    }
    assert summary(team.eng, workspace=other) == {
        "unread": 1,
        "pending_update_requests": 0,
        "other_workspaces": 3,
    }
    assert summary(team.eng, workspace="personal") == {
        "unread": 0,
        "pending_update_requests": 0,
        "other_workspaces": 4,
    }


def test_mark_all_as_read_stays_in_its_workspace(team: Team) -> None:
    other = second_organization(team, team.eng)
    team.eng_task(team.owner, assigned_to=team.ids["Eve Eng"])

    response = team.eng.post("/api/v1/notifications/read-all", params={"workspace": team.id})

    assert response.status_code == 204
    assert summary(team.eng, workspace=team.id)["unread"] == 0
    assert summary(team.eng, workspace=other)["unread"] == 1


def test_update_requests_are_listed_for_their_own_workspace(team: Team) -> None:
    other = second_organization(team, team.eng)
    task = team.eng_task(team.owner, assigned_to=team.ids["Eve Eng"])
    ask(team.lead, task, team.ids["Eve Eng"])

    def listed(workspace: int | str) -> int:
        response = team.eng.get("/api/v1/me/update-requests", params={"workspace": workspace})
        return len(response.json())

    assert listed(team.id) == 1
    assert listed(other) == 0
    assert listed("personal") == 0


def test_notices_from_a_lost_organization_move_to_personal(team: Team) -> None:
    team.eng_task(team.owner, title="Confidential merger", assigned_to=team.ids["Eve Eng"])
    member = f"{team.base}/members/{team.membership_ids['Eve Eng']}"

    team.owner.post(f"{member}/suspend", json={})

    response = team.eng.get("/api/v1/inbox", params={"workspace": "personal"})
    assert {item["type"] for item in response.json()["items"]} == {
        "assigned",
        "membership_suspended",
    }
    assert "Confidential merger" not in response.text
    assert summary(team.eng, workspace="personal")["unread"] == 2

    team.owner.post(f"{member}/reactivate")
    assert types(team.eng, workspace="personal") == []
    assert "membership_suspended" in types(team.eng, workspace=team.id)


def test_a_declined_applicant_reads_the_answer_in_personal(team: Team, person) -> None:
    applicant = person("Dee Declined")
    request = request_to_join(applicant, team.id, team.engineering).json()

    team.owner.post(f"{team.base}/membership-requests/{request['id']}/reject", json={})

    assert types(applicant, workspace="personal") == ["membership_rejected"]


def test_an_inbox_is_only_open_to_members_of_that_workspace(team: Team, person) -> None:
    stranger = person("Sue Stranger")
    params = {"workspace": team.id}

    assert stranger.get("/api/v1/inbox", params=params).status_code == 404
    assert stranger.get("/api/v1/inbox/summary", params=params).status_code == 404
    assert stranger.post("/api/v1/notifications/read-all", params=params).status_code == 404
    assert stranger.get("/api/v1/me/update-requests", params=params).json() == []
    assert stranger.get("/api/v1/inbox", params={"workspace": "nowhere"}).status_code == 422
