from zoneinfo import available_timezones

from pydantic import Field, field_validator

from app.common.schemas import ApiModel, InputModel, UtcDateTime
from app.modules.users.models import ThemePreference

_TIMEZONES = frozenset(available_timezones())


def validate_timezone(value: str) -> str:
    if value not in _TIMEZONES:
        raise ValueError("Unknown timezone; use an IANA name such as 'Asia/Kolkata'")
    return value


class UserRead(ApiModel):
    id: int
    email: str
    name: str
    timezone: str
    theme: ThemePreference
    sidebar_collapsed: bool
    last_organization_id: int | None
    created_at: UtcDateTime


class PreferencesRead(ApiModel):
    theme: ThemePreference
    sidebar_collapsed: bool
    last_organization_id: int | None


class PreferencesUpdate(InputModel):
    """Only what's sent changes. Sending null for the organization means Personal."""

    theme: ThemePreference | None = None
    sidebar_collapsed: bool | None = None
    last_organization_id: int | None = None


class UserUpdate(InputModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    timezone: str | None = None

    @field_validator("timezone")
    @classmethod
    def check_timezone(cls, value: str | None) -> str | None:
        return None if value is None else validate_timezone(value)
