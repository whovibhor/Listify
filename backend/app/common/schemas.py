import re
from datetime import UTC, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, PlainSerializer, ValidationInfo, field_validator

# Line breaks in a name would become header injection once real email is sent, and the others
# break logs and exports. Tabs stay allowed: they arrive with text pasted from spreadsheets.
_NOT_ALLOWED_IN_ONE_LINE = re.compile(r"[\x00-\x08\x0a-\x1f\x7f\x85\u2028\u2029]")
_NOT_ALLOWED_IN_TEXT = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_MULTILINE_FIELDS = frozenset({"description", "note", "reason"})
# Secrets are compared, never displayed, and any character is valid in a password.
_UNCHECKED_FIELDS = frozenset({"password", "current_password", "new_password", "token"})


def _serialize_utc(value: datetime) -> str:
    # DB values are naive UTC (ADR-019); emit explicit ISO 8601 with a Z suffix.
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


UtcDateTime = Annotated[datetime, PlainSerializer(_serialize_utc, return_type=str)]


class ApiModel(BaseModel):
    """Base for response schemas built from ORM objects."""

    model_config = ConfigDict(from_attributes=True)


class InputModel(BaseModel):
    """Base for request bodies: strip whitespace and reject unknown fields."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    @field_validator("*", mode="after")
    @classmethod
    def reject_control_characters(cls, value: object, info: ValidationInfo) -> object:
        if not isinstance(value, str) or info.field_name in _UNCHECKED_FIELDS:
            return value
        multiline = info.field_name in _MULTILINE_FIELDS
        if (_NOT_ALLOWED_IN_TEXT if multiline else _NOT_ALLOWED_IN_ONE_LINE).search(value):
            raise ValueError("Remove line breaks and special control characters.")
        return value
