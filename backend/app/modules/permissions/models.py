from sqlalchemy import Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, IdType

role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", IdType, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column(
        "permission_id",
        IdType,
        ForeignKey("permissions.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    **MYSQL_TABLE_ARGS,
)


class Permission(Base):
    __tablename__ = "permissions"
    __table_args__ = MYSQL_TABLE_ARGS

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(200), nullable=False)


class Role(Base):
    """Predefined roles, seeded by migration. A custom role builder is a later feature (P2)."""

    __tablename__ = "roles"
    __table_args__ = MYSQL_TABLE_ARGS

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    # "organization" roles apply everywhere in the org; "department" roles need a department.
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(String(200), nullable=False)

    permissions: Mapped[list[Permission]] = relationship(
        secondary=role_permissions, lazy="selectin"
    )
