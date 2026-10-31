import enum
from datetime import datetime

from sqlalchemy import Boolean, Enum, ForeignKey, String, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, IdType, TimestampMixin, UtcDateTime, utc_now


class ThemePreference(enum.StrEnum):
    LIGHT = "light"
    DARK = "dark"
    SYSTEM = "system"


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = MYSQL_TABLE_ARGS

    id: Mapped[int] = mapped_column(IdType, primary_key=True, autoincrement=True)
    # Stored normalized (trimmed, lower-case); the unique index enforces one account per email.
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    terms_accepted_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    password_changed_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)

    # Loaded only when read: most queries that load a user just want their name.
    preferences: Mapped["UserPreferences | None"] = relationship(
        uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def theme(self) -> ThemePreference:
        return self.preferences.theme if self.preferences else ThemePreference.SYSTEM

    @property
    def sidebar_collapsed(self) -> bool:
        return self.preferences.sidebar_collapsed if self.preferences else False

    @property
    def last_organization_id(self) -> int | None:
        return self.preferences.last_organization_id if self.preferences else None


class UserPreferences(Base):
    """Per-user settings that must follow the user across devices (one row per user).

    Typed columns rather than key/value pairs so values are validated by the database too;
    notification preferences join this table in Phase 8.
    """

    __tablename__ = "user_preferences"
    __table_args__ = MYSQL_TABLE_ARGS

    user_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    theme: Mapped[ThemePreference] = mapped_column(
        Enum(
            ThemePreference,
            name="theme_preference",
            native_enum=False,
            create_constraint=True,
            length=10,
            values_callable=lambda members: [m.value for m in members],
        ),
        nullable=False,
        default=ThemePreference.SYSTEM,
    )
    sidebar_collapsed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    # The workspace to reopen; null means Personal. Membership is rechecked before it's used.
    last_organization_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=utc_now, onupdate=utc_now
    )
