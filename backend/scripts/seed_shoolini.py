"""Fills the development database with a believable Shoolini University.

Usage (from backend/):  .venv\\Scripts\\python.exe -m scripts.seed_shoolini

Adds 16 fictional members and months of history to the existing organization, so that reports,
boards and admin pages have real-looking data to show. Dates are relative to the day it runs.
Existing people and tasks aren't changed, apart from filling in empty department descriptions.

It runs as one transaction, refuses to run in production, and does nothing if it has already run.
Nothing removes this data except deleting it in the app. Sample people sign in with
SEED_PASSWORD, and their addresses end in `.example`, so no real inbox can receive anything.
"""

import random
import struct
import sys
import zlib
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.storage import get_storage
from app.common.time import END_OF_DAY, local_to_utc, local_today, zone
from app.core.config import get_settings
from app.db.base import utc_now
from app.db.session import get_sessionmaker
from app.modules.audit_logs.models import AuditLog
from app.modules.auth.passwords import hash_password
from app.modules.auth.tokens import hash_token, new_token
from app.modules.collaboration.models import (
    TaskAttachment,
    TaskComment,
    TaskUpdateRequest,
    UpdateRequestStatus,
)
from app.modules.memberships.models import (
    DepartmentMembership,
    MembershipRequest,
    MembershipRole,
    MembershipStatus,
    OrganizationInvitation,
    OrganizationMembership,
    RequestStatus,
)
from app.modules.notifications.models import Notification
from app.modules.organizations.models import Department, Organization
from app.modules.permissions.models import Role
from app.modules.tasks.models import (
    Tag,
    TagColor,
    Task,
    TaskActivity,
    TaskCollaborator,
    TaskPriority,
    TaskStatus,
    TaskVisibility,
    TaskVisibilityGrant,
    WorkspaceType,
)
from app.modules.users.models import User
from scripts.seed_shoolini_data import (
    APPLICANTS,
    ATTACHMENTS,
    DEPARTMENT_DESCRIPTIONS,
    FILE_CONTENT,
    PEOPLE,
    PERSONAL_TASKS,
    TAGS,
    TASKS,
    UPDATE_REQUESTS,
    T,
)

ORGANIZATION_SLUG = "shoolini-university"
SEED_PASSWORD = "Shoolini-Demo-2026!"  # noqa: S105 - sample accounts in development only
EMAIL_DOMAIN = "shoolini.example"
MOVED_AFTER_COMPLETION = "Accessibility audit of LMS"
LEFT_BEHIND_BY_TRANSFER = "Close out Q2 transport vendor invoices"
FINISHED_STATES = {"done", "late", "archived"}
UNREAD_WITHIN_DAYS = 10


def email_for(name: str) -> str:
    return f"{name.lower().replace(' ', '.')}@{EMAIL_DOMAIN}"


def simple_pdf(title: str) -> bytes:
    """A small but valid one-page PDF."""
    text = title.replace("(", "").replace(")", "")
    stream = f"BT /F1 20 Tf 60 760 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    body = b"%PDF-1.4\n"
    offsets = []
    for number, content in enumerate(objects, start=1):
        offsets.append(len(body))
        body += f"{number} 0 obj\n".encode() + content + b"\nendobj\n"
    xref = len(body)
    body += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        body += f"{offset:010d} 00000 n \n".encode()
    return (
        body
        + f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n".encode()
        + f"startxref\n{xref}\n%%EOF\n".encode()
    )


def simple_png(width: int = 480, height: int = 280) -> bytes:
    """A plain wireframe-coloured image, standing in for a design prototype."""
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            header = y < 36
            panel = 40 <= x < width - 40 and 70 <= y < height - 40
            rows += bytes(
                (98, 66, 203) if header else (255, 255, 255) if panel else (240, 240, 247)
            )

    def chunk(kind: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )


@dataclass
class Seeder:
    db: Session
    organization: Organization
    now: datetime
    rng: random.Random = field(default_factory=lambda: random.Random(2027))  # noqa: S311
    people: dict[str, User] = field(default_factory=dict)
    memberships: dict[str, OrganizationMembership] = field(default_factory=dict)
    departments: dict[str, Department] = field(default_factory=dict)
    managers: dict[str, str] = field(default_factory=dict)
    leads: dict[str, str] = field(default_factory=dict)
    tags: dict[str, Tag] = field(default_factory=dict)
    tasks: dict[str, Task] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.tz = zone(self.organization.timezone)
        self.today = local_today(self.now, self.tz)

    # --- Helpers ---------------------------------------------------------------------------

    def count(self, what: str, amount: int = 1) -> None:
        self.counts[what] = self.counts.get(what, 0) + amount

    def working_time(self, days_ago: float) -> datetime:
        """A moment during working hours, moved off Sundays. Never later than now."""
        day = self.today - timedelta(days=int(days_ago))
        if day.weekday() == 6:
            day -= timedelta(days=1)
        moment = local_to_utc(day, time(self.rng.randint(9, 18), self.rng.randint(0, 59)), self.tz)
        return min(moment, self.now - timedelta(minutes=self.rng.randint(5, 240)))

    def deadline(self, days_from_today: int, timed: bool) -> tuple[datetime, bool]:
        day = self.today + timedelta(days=days_from_today)
        if timed:
            return local_to_utc(day, time(17, 0), self.tz), False
        return local_to_utc(day, END_OF_DAY, self.tz), True

    def activity(
        self,
        task: Task,
        actor: User | None,
        event: str,
        at: datetime,
        old: dict[str, Any] | None = None,
        new: dict[str, Any] | None = None,
    ) -> None:
        self.db.add(
            TaskActivity(
                task_id=task.id,
                actor_id=actor.id if actor else None,
                event_type=event,
                old_value=old,
                new_value=new,
                created_at=at,
            )
        )
        self.count("activity entries")

    def notify(
        self,
        recipients: list[User],
        kind: str,
        at: datetime,
        *,
        actor: User | None = None,
        task: Task | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        for person in {user.id: user for user in recipients}.values():
            if actor is not None and person.id == actor.id:
                continue
            unread = self.now - at < timedelta(days=UNREAD_WITHIN_DAYS)
            self.db.add(
                Notification(
                    user_id=person.id,
                    type=kind,
                    actor_id=actor.id if actor else None,
                    organization_id=self.organization.id,
                    task_id=task.id if task else None,
                    data=data,
                    read_at=None if unread else at + timedelta(hours=self.rng.randint(1, 30)),
                    created_at=at,
                )
            )
            self.count("notifications")

    def audit(
        self,
        at: datetime,
        actor: User,
        action: str,
        target_type: str,
        target_id: int | None,
        details: dict[str, Any],
    ) -> None:
        self.db.add(
            AuditLog(
                organization_id=self.organization.id,
                actor_id=actor.id,
                action=action,
                target_type=target_type,
                target_id=target_id,
                details=details,
                created_at=at,
            )
        )
        self.count("audit entries")

    # --- People ----------------------------------------------------------------------------

    def load_existing(self) -> None:
        self.people["vibhor"] = self.db.get(User, self.organization.created_by)
        self.people["diya"] = self.db.scalar(select(User).where(User.name == "Diya Jaswal"))
        self.departments = {
            department.name: department
            for department in self.db.scalars(
                select(Department).where(Department.organization_id == self.organization.id)
            )
        }
        for name, description in DEPARTMENT_DESCRIPTIONS.items():
            if self.departments[name].description is None:
                self.departments[name].description = description
        self.leads["Engineering"] = "diya"

    def add_people(self) -> None:
        roles = {role.key: role for role in self.db.scalars(select(Role))}
        owner = self.people["vibhor"]
        joined_through_request = {"tanvi", "karan", "rahul"}
        for person in PEOPLE:
            joined = self.working_time(person.joined_days_ago)
            user = User(
                email=email_for(person.name),
                name=person.name,
                password_hash=hash_password(SEED_PASSWORD),
                timezone=person.timezone,
                terms_accepted_at=joined,
                password_changed_at=joined,
                last_login_at=self.working_time(self.rng.randint(1, 9)),
                created_at=joined,
                updated_at=joined,
            )
            self.db.add(user)
            self.db.flush()
            self.people[person.key] = user
            primary = self.departments[person.departments[0]]
            membership = OrganizationMembership(
                organization_id=self.organization.id,
                user_id=user.id,
                status=MembershipStatus.ACTIVE,
                primary_department_id=primary.id,
                job_title=person.title,
                joined_at=joined,
            )
            self.db.add(membership)
            self.db.flush()
            self.memberships[person.key] = membership
            for name in person.departments:
                self.db.add(
                    DepartmentMembership(
                        organization_id=self.organization.id,
                        department_id=self.departments[name].id,
                        user_id=user.id,
                        joined_at=joined,
                    )
                )
            grants: list[tuple[str, int | None]] = (
                [("admin", None)] if person.role == "admin" else [("member", None)]
            )
            if person.role in ("department_manager", "team_lead"):
                grants.append((person.role, primary.id))
                target = self.managers if person.role == "department_manager" else self.leads
                target[person.departments[0]] = person.key
            for key, department_id in grants:
                self.db.add(
                    MembershipRole(
                        membership_id=membership.id,
                        role_id=roles[key].id,
                        department_id=department_id,
                        assigned_by=owner.id,
                        created_at=joined,
                    )
                )
            details = {
                "user_id": user.id,
                "user_name": user.name,
                "role": person.role,
                "department": primary.name,
            }
            if person.key in joined_through_request:
                self.db.add(
                    MembershipRequest(
                        organization_id=self.organization.id,
                        user_id=user.id,
                        requested_department_id=primary.id,
                        job_title=person.title,
                        note="Joining the team after discussing this with the department.",
                        status=RequestStatus.APPROVED,
                        reviewed_by=owner.id,
                        reviewed_at=joined,
                        created_at=joined - timedelta(days=2),
                        updated_at=joined,
                    )
                )
                self.audit(
                    joined, owner, "membership.approved", "membership_request", user.id, details
                )
            else:
                self.audit(
                    joined, user, "invitation.accepted", "organization_invitation", user.id, details
                )
            self.notify(
                [user],
                "membership_approved",
                joined,
                actor=owner,
                data={"organization_name": self.organization.name},
            )
            self.count("members")

    def add_special_memberships(self) -> None:
        """A suspension and a transfer, so that their effects can be seen in the app."""
        owner = self.people["vibhor"]
        admin = self.people["meenakshi"]
        name = self.organization.name

        moved_at = self.working_time(46)
        arjun = self.memberships["arjun"]
        self.audit(
            moved_at,
            admin,
            "member.transferred",
            "organization_membership",
            arjun.id,
            {
                "user_id": arjun.user_id,
                "user_name": self.people["arjun"].name,
                "from_department": "Operations",
                "to_department": "Sales",
            },
        )
        self.notify(
            [self.people["arjun"]],
            "member_transferred",
            moved_at,
            actor=admin,
            data={"organization_name": name, "department": "Sales"},
        )

        suspended_at = self.working_time(6)
        manish = self.memberships["manish"]
        manish.status = MembershipStatus.SUSPENDED
        self.audit(
            suspended_at,
            owner,
            "member.suspended",
            "organization_membership",
            manish.id,
            {
                "user_id": manish.user_id,
                "user_name": self.people["manish"].name,
                "note": "On leave pending a procurement review.",
            },
        )
        self.notify(
            [self.people["manish"]],
            "membership_suspended",
            suspended_at,
            actor=owner,
            data={"organization_name": name},
        )

        promoted_at = self.working_time(90)
        sneha = self.memberships["sneha"]
        self.audit(
            promoted_at,
            owner,
            "member.roles_changed",
            "organization_membership",
            sneha.id,
            {"user_id": sneha.user_id, "user_name": self.people["sneha"].name},
        )
        self.notify(
            [self.people["sneha"]],
            "role_changed",
            promoted_at,
            actor=owner,
            data={"organization_name": name},
        )

    def add_applicants(self) -> None:
        reviewer = self.people["neha"]
        for name, status, department, title, note, days_ago in APPLICANTS:
            asked = self.working_time(days_ago)
            user = User(
                email=email_for(name),
                name=name,
                password_hash=hash_password(SEED_PASSWORD),
                timezone="Asia/Calcutta",
                terms_accepted_at=asked,
                password_changed_at=asked,
                created_at=asked,
                updated_at=asked,
            )
            self.db.add(user)
            self.db.flush()
            rejected = status == "rejected"
            reviewed = self.working_time(days_ago - 2) if rejected else None
            self.db.add(
                MembershipRequest(
                    organization_id=self.organization.id,
                    user_id=user.id,
                    requested_department_id=self.departments[department].id,
                    job_title=title,
                    note=note,
                    status=RequestStatus.REJECTED if rejected else RequestStatus.PENDING,
                    reviewed_by=reviewer.id if rejected else None,
                    reviewed_at=reviewed,
                    review_note="No internship openings this semester." if rejected else None,
                    created_at=asked,
                    updated_at=reviewed or asked,
                )
            )
            self.count("join requests")
            if rejected:
                self.audit(
                    reviewed,
                    reviewer,
                    "membership.rejected",
                    "membership_request",
                    user.id,
                    {"user_id": user.id, "user_name": name},
                )
                self.notify(
                    [user],
                    "membership_rejected",
                    reviewed,
                    actor=reviewer,
                    data={"organization_name": self.organization.name},
                )

    def add_invitations(self) -> None:
        roles = {role.key: role for role in self.db.scalars(select(Role))}
        admin = self.people["meenakshi"]
        options = [
            (f"dean.research@{EMAIL_DOMAIN}", "member", None, 3, 11, None),
            (f"lab.coordinator@{EMAIL_DOMAIN}", "member", "Operations", 1, 6, None),
            (None, "member", "Engineering", 2, 12, None),
            (f"finance.officer@{EMAIL_DOMAIN}", "member", "HR", 20, -6, None),
            (f"old.contact@{EMAIL_DOMAIN}", "member", "Sales", 15, 3, "revoked"),
        ]
        for email, role, department, days_ago, expires_in, state in options:
            created = self.working_time(days_ago)
            invitation = OrganizationInvitation(
                organization_id=self.organization.id,
                email=email,
                token_hash=hash_token(new_token()),
                role_id=roles[role].id,
                department_id=self.departments[department].id if department else None,
                expires_at=self.now + timedelta(days=expires_in),
                revoked_at=created + timedelta(days=4) if state == "revoked" else None,
                created_by=admin.id,
                created_at=created,
            )
            self.db.add(invitation)
            self.db.flush()
            self.audit(
                created,
                admin,
                "invitation.created",
                "organization_invitation",
                invitation.id,
                {"email": email, "role": role},
            )
            if state == "revoked":
                self.audit(
                    invitation.revoked_at,
                    admin,
                    "invitation.revoked",
                    "organization_invitation",
                    invitation.id,
                    {},
                )
            self.count("invitations")

    def add_tags(self) -> None:
        for name, color in TAGS:
            tag = Tag(
                organization_id=self.organization.id,
                name=name,
                color=TagColor(color),
                created_at=self.working_time(self.rng.randint(120, 300)),
            )
            self.db.add(tag)
            self.tags[name] = tag
            self.count("tags")
        self.db.flush()

    # --- Tasks -----------------------------------------------------------------------------

    def schedule(self, state: str) -> dict[str, int]:
        """Days ago for each milestone, and days until the deadline (negative is past)."""
        rng = self.rng
        if state in FINISHED_STATES:
            finished = rng.randint(1, 96) if state != "archived" else rng.randint(45, 120)
            created = finished + rng.randint(5, 34)
            if state == "late":
                due = -(finished + rng.randint(1, 7))
            else:
                due = -finished + rng.randint(0, 5)
            return {"created": created, "finished": finished, "due": due}
        if state == "todo":
            return {"created": rng.randint(1, 14), "due": rng.randint(5, 45)}
        if state == "doing":
            return {"created": rng.randint(4, 36), "due": rng.randint(2, 28)}
        if state == "review":
            return {"created": rng.randint(7, 30), "due": rng.randint(1, 12)}
        if state == "overdue":
            return {"created": rng.randint(14, 45), "due": -rng.randint(1, 14)}
        if state == "blocked":
            return {"created": rng.randint(12, 40), "due": rng.randint(-3, 15)}
        created = rng.randint(25, 110)  # cancelled
        return {"created": created, "finished": created - rng.randint(4, 18), "due": 0}

    def status_for(self, state: str) -> TaskStatus:
        return {
            "todo": TaskStatus.NOT_STARTED,
            "doing": TaskStatus.IN_PROGRESS,
            "overdue": TaskStatus.IN_PROGRESS,
            "blocked": TaskStatus.BLOCKED,
            "review": TaskStatus.IN_REVIEW,
            "cancelled": TaskStatus.CANCELLED,
        }.get(state, TaskStatus.COMPLETED)

    def creator_for(self, spec: T, department: str) -> User:
        if spec.by:
            return self.people[spec.by]
        lead = self.leads.get(department)
        choose_lead = lead and lead != spec.who and self.rng.random() < 0.3
        return self.people[lead if choose_lead else self.managers.get(department, "vibhor")]

    def approver_for(self, spec: T, department: str) -> User:
        manager = self.managers.get(department, "vibhor")
        return self.people["vibhor" if manager == spec.who else manager]

    def add_task(self, spec: T, department_name: str) -> None:
        plan = self.schedule(spec.state)
        created_at = self.working_time(plan["created"])
        creator = self.creator_for(spec, department_name)
        assignee = self.people[spec.who] if spec.who else None
        department = self.departments.get(department_name)
        finished = spec.state in FINISHED_STATES
        cancelled = spec.state == "cancelled"
        approver = self.approver_for(spec, department_name)
        ends_at = self.working_time(plan["finished"]) if finished or cancelled else None
        if ends_at is not None and ends_at <= created_at:
            ends_at = created_at + timedelta(days=2)

        timed = self.rng.random() < 0.2
        due_at, all_day = None, True
        no_deadline = spec.state == "todo" and self.rng.random() < 0.2
        if not cancelled and not no_deadline:
            due_at, all_day = self.deadline(plan["due"], timed)

        estimated = spec.hours * 60 if spec.hours else None
        task = Task(
            workspace_type=WorkspaceType.ORGANIZATION,
            organization_id=self.organization.id,
            department_id=department.id if department else None,
            created_by=creator.id,
            assigned_to=assignee.id if assignee else None,
            title=spec.title,
            description=spec.description,
            status=self.status_for(spec.state),
            priority=TaskPriority(spec.priority),
            visibility=TaskVisibility(spec.visibility),
            start_at=created_at if spec.state != "todo" else None,
            due_at=due_at,
            due_all_day=all_day,
            estimated_minutes=estimated,
            actual_minutes=(
                int(estimated * self.rng.uniform(0.75, 1.3)) if finished and estimated else None
            ),
            sort_order=0,
            completed_at=ends_at if finished else None,
            completed_by=approver.id if finished else None,
            completed_department_id=department.id if finished and department else None,
            created_at=created_at,
            updated_at=created_at,
        )
        task.tags = [self.tags[name] for name in spec.tags]
        self.db.add(task)
        self.db.flush()
        self.tasks[spec.title] = task
        self.count("tasks")

        self.activity(task, creator, "created", created_at, new={"title": spec.title})
        if assignee:
            self.activity(
                task, creator, "assigned", created_at, {"name": None}, {"name": assignee.name}
            )
            self.notify([assignee], "assigned", created_at, actor=creator, task=task)

        collaborators = [self.people[key] for key in spec.collaborators]
        for person in collaborators:
            self.db.add(
                TaskCollaborator(
                    task_id=task.id, user_id=person.id, added_by=creator.id, created_at=created_at
                )
            )
            self.activity(
                task, creator, "collaborator_added", created_at, new={"name": person.name}
            )
            self.notify([person], "collaborator_added", created_at, actor=creator, task=task)
            self.count("collaborators")
        for key in spec.shown_to:
            self.db.add(
                TaskVisibilityGrant(
                    task_id=task.id,
                    user_id=self.people[key].id,
                    granted_by=creator.id,
                    created_at=created_at,
                )
            )

        last = self.now - timedelta(hours=2) if ends_at is None else ends_at
        worker = assignee or creator
        moved_on_at = created_at + timedelta(hours=self.rng.randint(4, 40))
        if spec.state != "todo" and moved_on_at < last:
            old = "not_started"
            if spec.state != "cancelled" or self.rng.random() < 0.5:
                self.activity(
                    task,
                    worker,
                    "status_changed",
                    moved_on_at,
                    {"status": old},
                    {"status": "in_progress"},
                )
                old = "in_progress"
            if spec.state == "blocked":
                at = last - timedelta(days=self.rng.randint(1, 5))
                self.activity(
                    task,
                    worker,
                    "status_changed",
                    max(at, moved_on_at),
                    {"status": old},
                    {"status": "blocked"},
                )
            if spec.state == "review" or finished:
                at = last - timedelta(hours=self.rng.randint(3, 30))
                self.activity(
                    task,
                    worker,
                    "status_changed",
                    max(at, moved_on_at),
                    {"status": old},
                    {"status": "in_review"},
                )
                old = "in_review"
            if finished:
                self.activity(
                    task, approver, "completed", ends_at, {"status": old}, {"status": "completed"}
                )
            if cancelled:
                self.activity(
                    task,
                    creator,
                    "status_changed",
                    ends_at,
                    {"status": old},
                    {"status": "cancelled"},
                )

        self.add_subtasks(task, spec, creator, worker, created_at, last, finished)
        self.add_comments(task, spec, creator, assignee, collaborators, created_at, last)
        if spec.state == "archived":
            archived_at = ends_at + timedelta(days=self.rng.randint(8, 30))
            task.archived_at = min(archived_at, self.now - timedelta(days=1))
            self.activity(task, creator, "archived", task.archived_at)
            self.audit(
                task.archived_at, creator, "task.archived", "task", task.id, {"title": spec.title}
            )
        task.updated_at = task.archived_at or last

    def add_subtasks(
        self,
        task: Task,
        spec: T,
        creator: User,
        worker: User,
        created_at: datetime,
        last: datetime,
        finished: bool,
    ) -> None:
        span = max((last - created_at).total_seconds(), 3600)
        for position, (title, done) in enumerate(spec.subtasks):
            made_at = created_at + timedelta(minutes=10 + position * 5)
            closed = done or finished
            closed_at = created_at + timedelta(
                seconds=span * (position + 1) / (len(spec.subtasks) + 1)
            )
            subtask = Task(
                workspace_type=WorkspaceType.ORGANIZATION,
                organization_id=self.organization.id,
                created_by=creator.id,
                parent_task_id=task.id,
                title=title,
                status=TaskStatus.COMPLETED if closed else TaskStatus.NOT_STARTED,
                priority=TaskPriority.MEDIUM,
                due_all_day=True,
                sort_order=position,
                completed_at=closed_at if closed else None,
                completed_by=worker.id if closed else None,
                created_at=made_at,
                updated_at=closed_at if closed else made_at,
            )
            self.db.add(subtask)
            self.db.flush()
            self.activity(subtask, creator, "created", made_at, new={"title": title})
            self.activity(
                task,
                creator,
                "subtask_added",
                made_at,
                new={"title": title, "subtask_id": subtask.id},
            )
            if closed:
                self.activity(
                    subtask,
                    worker,
                    "completed",
                    closed_at,
                    {"status": "not_started"},
                    {"status": "completed"},
                )
            self.count("subtasks")

    def add_comments(
        self,
        task: Task,
        spec: T,
        creator: User,
        assignee: User | None,
        collaborators: list[User],
        created_at: datetime,
        last: datetime,
    ) -> None:
        span = max((last - created_at).total_seconds(), 3600)
        for position, (author_key, body) in enumerate(spec.talk):
            author = self.people[author_key]
            at = created_at + timedelta(seconds=span * (position + 1) / (len(spec.talk) + 1))
            self.db.add(
                TaskComment(
                    task_id=task.id, author_id=author.id, body=body, created_at=at, updated_at=at
                )
            )
            self.activity(task, author, "comment_added", at)
            people = [creator, *collaborators]
            if assignee:
                people.append(assignee)
            mentioned = assignee if assignee and author.id != assignee.id and position % 2 else None
            if mentioned:
                self.notify([mentioned], "mention", at, actor=author, task=task)
                people = [person for person in people if person.id != mentioned.id]
            self.notify(people, "comment", at, actor=author, task=task)
            self.count("comments")

    def add_all_tasks(self) -> None:
        for department, specs in TASKS.items():
            for spec in specs:
                self.add_task(spec, department)

    def add_special_tasks(self) -> None:
        """Work moved after completion, and an edited and a deleted comment."""
        moved = self.tasks[MOVED_AFTER_COMPLETION]
        at = moved.completed_at + timedelta(days=3)
        if at < self.now:
            mover = self.people["rohan"]
            moved.department_id = self.departments["Backend"].id
            self.activity(
                moved, mover, "moved", at, {"department": "Engineering"}, {"department": "Backend"}
            )
            self.audit(
                at,
                mover,
                "task.moved",
                "task",
                moved.id,
                {
                    "title": moved.title,
                    "from_department": "Engineering",
                    "to_department": "Backend",
                },
            )

        edited = self.db.scalar(
            select(TaskComment).where(
                TaskComment.task_id == self.tasks["Launch Admissions 2027 campaign"].id
            )
        )
        edited.edited_at = edited.created_at + timedelta(minutes=12)

        task = self.tasks["Redesign university homepage"]
        at = self.working_time(3)
        author = self.people["ishita"]
        self.db.add(
            TaskComment(
                task_id=task.id,
                author_id=author.id,
                body="Posted in the wrong task.",
                created_at=at,
                updated_at=at,
                deleted_at=at + timedelta(minutes=5),
                deleted_by=author.id,
            )
        )
        self.activity(task, author, "comment_added", at)
        self.activity(task, author, "comment_deleted", at + timedelta(minutes=5))

    def add_personal_tasks(self) -> None:
        for key, items in PERSONAL_TASKS.items():
            owner = self.people[key]
            for title, due_in, state in items:
                done = state == "done"
                created_at = self.working_time(
                    (abs(due_in or 0) if done else 0) + self.rng.randint(2, 15)
                )
                finished_at = None
                if done:
                    finished_at = self.working_time(
                        max(1, abs(due_in or 2) + self.rng.randint(-2, 2))
                    )
                    finished_at = max(finished_at, created_at + timedelta(hours=3))
                due_at, all_day = (None, True) if due_in is None else self.deadline(due_in, False)
                task = Task(
                    workspace_type=WorkspaceType.PERSONAL,
                    owner_user_id=owner.id,
                    created_by=owner.id,
                    title=title,
                    status={
                        "todo": TaskStatus.NOT_STARTED,
                        "doing": TaskStatus.IN_PROGRESS,
                        "done": TaskStatus.COMPLETED,
                    }[state],
                    priority=self.rng.choice(list(TaskPriority)),
                    visibility=TaskVisibility.PRIVATE,
                    due_at=due_at,
                    due_all_day=all_day,
                    sort_order=0,
                    completed_at=finished_at,
                    completed_by=owner.id if done else None,
                    created_at=created_at,
                    updated_at=finished_at or created_at,
                )
                self.db.add(task)
                self.db.flush()
                self.activity(task, owner, "created", created_at, new={"title": title})
                if done:
                    self.activity(
                        task,
                        owner,
                        "completed",
                        finished_at,
                        {"status": "not_started"},
                        {"status": "completed"},
                    )
                self.count("personal tasks")

    # --- Collaboration ---------------------------------------------------------------------

    def add_update_requests(self) -> None:
        for title, asker_key, recipient_key, message, state, reply, days_ago in UPDATE_REQUESTS:
            task = self.tasks[title]
            asker, recipient = self.people[asker_key], self.people[recipient_key]
            asked = self.working_time(days_ago)
            pending = state == "pending"
            answered = None if pending else asked + timedelta(hours=self.rng.randint(2, 40))
            if answered is not None:
                answered = min(answered, self.now - timedelta(hours=1))
            self.db.add(
                TaskUpdateRequest(
                    task_id=task.id,
                    requester_id=asker.id,
                    recipient_id=recipient.id,
                    message=message,
                    respond_by=(
                        self.now + timedelta(days=self.rng.randint(-1, 4)) if pending else None
                    ),
                    status=UpdateRequestStatus(state),
                    response_note=reply,
                    responded_at=answered if state == "responded" else None,
                    created_at=asked,
                    updated_at=answered or asked,
                )
            )
            self.activity(task, asker, "update_requested", asked, new={"name": recipient.name})
            self.notify([recipient], "update_requested", asked, actor=asker, task=task)
            if state == "responded":
                self.activity(
                    task, recipient, "update_responded", answered, new={"name": asker.name}
                )
                self.notify([asker], "update_responded", answered, actor=recipient, task=task)
            if state == "cancelled":
                self.activity(
                    task, asker, "update_cancelled", answered, old={"name": recipient.name}
                )
                self.notify([recipient], "update_cancelled", answered, actor=asker, task=task)
            self.count("update requests")

    def add_attachments(self) -> None:
        storage = get_storage()
        for title, uploader_key, filename, content_key in ATTACHMENTS:
            task = self.tasks[title]
            uploader = self.people[uploader_key]
            at = task.created_at + (self.now - task.created_at) * self.rng.uniform(0.2, 0.6)
            if content_key == "pdf":
                content, kind = simple_pdf(title), "application/pdf"
            elif content_key == "png":
                content, kind = simple_png(), "image/png"
            else:
                content = FILE_CONTENT[content_key].encode()
                kind = "text/csv" if filename.endswith(".csv") else "text/plain"
            self.db.add(
                TaskAttachment(
                    task_id=task.id,
                    uploaded_by=uploader.id,
                    filename=filename,
                    content_type=kind,
                    size_bytes=len(content),
                    storage_key=storage.save(content),
                    created_at=at,
                )
            )
            self.activity(task, uploader, "attachment_added", at, new={"filename": filename})
            self.count("attachments")

    def add_organization_history(self) -> None:
        owner = self.people["vibhor"]
        admin = self.people["meenakshi"]
        self.audit(
            self.working_time(120),
            admin,
            "organization.updated",
            "organization",
            self.organization.id,
            {"before": {"location": None}, "after": {"location": self.organization.location}},
        )
        today = self.today
        for days_ago, actor in ((3, owner), (18, admin), (41, owner)):
            start = today - timedelta(days=days_ago + 29)
            end = today - timedelta(days=days_ago)
            self.audit(
                self.working_time(days_ago),
                actor,
                "report.exported",
                "organization",
                self.organization.id,
                {"start": str(start), "end": str(end), "rows": 40 + days_ago * 2},
            )


def main() -> int:
    settings = get_settings()
    if settings.is_production:
        print("Refusing to run: sample data must never reach production.", file=sys.stderr)
        return 1

    with get_sessionmaker()() as db:
        organization = db.scalar(select(Organization).where(Organization.slug == ORGANIZATION_SLUG))
        if organization is None:
            print(f"Organization '{ORGANIZATION_SLUG}' not found.", file=sys.stderr)
            return 1
        if db.scalar(select(User.id).where(User.email.like(f"%@{EMAIL_DOMAIN}")).limit(1)):
            print("Sample data is already there, so nothing was changed.")
            return 0

        seeder = Seeder(db=db, organization=organization, now=utc_now())
        seeder.load_existing()
        seeder.add_people()
        seeder.add_applicants()
        seeder.add_invitations()
        seeder.add_tags()
        seeder.add_all_tasks()
        seeder.add_special_tasks()
        seeder.add_special_memberships()
        seeder.add_personal_tasks()
        seeder.add_update_requests()
        seeder.add_attachments()
        seeder.add_organization_history()
        db.commit()

    print(f"Seeded {settings.db_name}:")
    for what, total in sorted(seeder.counts.items()):
        print(f"  {what}: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
