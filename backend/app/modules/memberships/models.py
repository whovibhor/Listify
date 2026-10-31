import enum
from datetime import datetime

from sqlalchemy import (
    CHAR,
    Computed,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, IdType, TimestampMixin, UtcDateTime, utc_now
from app.modules.organizations.models import Department, Organization, str_enum
from app.modules.permissions.models import Role
from app.modules.users.models import User


class MembershipStatus(enum.StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    REMOVED = "removed"


class RequestStatus(enum.StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class OrganizationMembership(TimestampMixin, Base):
    """A user's link to an organization. Only status=active grants any access (BRD Rule 8)."""

    __tablename__ = "organization_memberships"
    __table_args__ = (
        UniqueConstraint(
            "organization_id", "user_id", name="uq_organization_memberships_organization_id_user_id"
        ),
        ForeignKeyConstraint(
            ["organization_id", "primary_department_id"],
            ["departments.organization_id", "departments.id"],
            name="fk_org_memberships_primary_department",
        ),
        Index("ix_organization_memberships_user_id_status", "user_id", "status"),
        MYSQL_TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[MembershipStatus] = mapped_column(
        str_enum(MembershipStatus, "membership_status"),
        nullable=False,
        default=MembershipStatus.ACTIVE,
    )
    primary_department_id: Mapped[int | None] = mapped_column(IdType, nullable=True)
    job_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utc_now)

    user: Mapped[User] = relationship()
    organization: Mapped[Organization] = relationship()
    roles: Mapped[list["MembershipRole"]] = relationship(
        lazy="selectin", cascade="all, delete-orphan", passive_deletes=True
    )


class DepartmentMembership(Base):
    __tablename__ = "department_memberships"
    __table_args__ = (
        UniqueConstraint(
            "department_id", "user_id", name="uq_department_memberships_department_id_user_id"
        ),
        ForeignKeyConstraint(
            ["organization_id", "department_id"],
            ["departments.organization_id", "departments.id"],
            name="fk_department_memberships_department",
        ),
        Index("ix_department_memberships_organization_id_user_id", "organization_id", "user_id"),
        MYSQL_TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(IdType, nullable=False)
    department_id: Mapped[int] = mapped_column(IdType, nullable=False)
    user_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    joined_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utc_now)

    department: Mapped[Department] = relationship(viewonly=True)


class MembershipRole(Base):
    """A role granted to a member: organization-wide, or limited to one department."""

    __tablename__ = "membership_roles"
    __table_args__ = (
        UniqueConstraint(
            "membership_id", "role_id", "department_id", name="uq_membership_roles_assignment"
        ),
        MYSQL_TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    membership_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("organization_memberships.id", ondelete="CASCADE"), nullable=False
    )
    role_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False
    )
    department_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("departments.id", ondelete="RESTRICT"), nullable=True
    )
    assigned_by: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utc_now)

    role: Mapped[Role] = relationship(lazy="joined")


class MembershipRequest(TimestampMixin, Base):
    """A request to join. It grants nothing until approved (BRD Rule 8)."""

    __tablename__ = "membership_requests"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "requested_department_id"],
            ["departments.organization_id", "departments.id"],
            name="fk_membership_requests_department",
        ),
        # MySQL has no partial unique indexes: this generated column is the user id only while
        # pending, so the database itself allows at most one pending request per person.
        UniqueConstraint(
            "organization_id", "pending_user_id", name="uq_membership_requests_one_pending"
        ),
        Index("ix_membership_requests_organization_id_status", "organization_id", "status"),
        Index("ix_membership_requests_user_id_status", "user_id", "status"),
        MYSQL_TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    requested_department_id: Mapped[int | None] = mapped_column(IdType, nullable=True)
    job_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[RequestStatus] = mapped_column(
        str_enum(RequestStatus, "membership_request_status"),
        nullable=False,
        default=RequestStatus.PENDING,
    )
    pending_user_id: Mapped[int | None] = mapped_column(
        IdType, Computed("if(status = 'pending', user_id, NULL)", persisted=True)
    )
    reviewed_by: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    review_note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    user: Mapped[User] = relationship(foreign_keys=[user_id])
    organization: Mapped[Organization] = relationship()


class OrganizationInvitation(Base):
    """Single-use invitation. `email` set = only that address; null = shareable link."""

    __tablename__ = "organization_invitations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "department_id"],
            ["departments.organization_id", "departments.id"],
            name="fk_organization_invitations_department",
        ),
        MYSQL_TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False
    )
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    token_hash: Mapped[str] = mapped_column(CHAR(64), unique=True, nullable=False)
    role_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False
    )
    department_id: Mapped[int | None] = mapped_column(IdType, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    accepted_by: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    created_by: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utc_now)

    organization: Mapped[Organization] = relationship()
    role: Mapped[Role] = relationship(lazy="joined")
    department: Mapped[Department | None] = relationship(viewonly=True)
