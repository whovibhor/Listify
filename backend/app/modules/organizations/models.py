import enum

from sqlalchemy import Boolean, Enum, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import MYSQL_TABLE_ARGS, Base, IdType, TimestampMixin


class OrganizationStatus(enum.StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class DepartmentStatus(enum.StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"


def str_enum(cls: type[enum.Enum], name: str) -> Enum:
    # VARCHAR + CHECK (not native ENUM) so later phases can add values without ALTER ... ENUM.
    return Enum(
        cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=20,
        values_callable=lambda members: [m.value for m in members],
    )


class Organization(TimestampMixin, Base):
    __tablename__ = "organizations"
    __table_args__ = MYSQL_TABLE_ARGS

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(140), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    # Private by default: only owners opting in appear in search (ADR-014).
    is_discoverable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # When on, work must pass through In Review before Completed (ADR-015, used in Phase 5).
    review_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[OrganizationStatus] = mapped_column(
        str_enum(OrganizationStatus, "organization_status"),
        nullable=False,
        default=OrganizationStatus.ACTIVE,
    )
    created_by: Mapped[int] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class Department(TimestampMixin, Base):
    __tablename__ = "departments"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_departments_organization_id_name"),
        # Target of composite foreign keys: a child row's department must belong to its org.
        UniqueConstraint("organization_id", "id", name="uq_departments_organization_id_id"),
        Index("ix_departments_organization_id_status", "organization_id", "status"),
        MYSQL_TABLE_ARGS,
    )

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    organization_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[DepartmentStatus] = mapped_column(
        str_enum(DepartmentStatus, "department_status"),
        nullable=False,
        default=DepartmentStatus.ACTIVE,
    )
    # Whether people may pick this department in a join request (FR-ORG-05).
    open_for_join_requests: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
