from datetime import UTC, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, PlainSerializer


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
