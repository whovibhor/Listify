from typing import Literal

from pydantic import EmailStr, Field, field_validator

from app.common.schemas import ApiModel, InputModel, UtcDateTime
from app.modules.auth.passwords import MAX_PASSWORD_LENGTH
from app.modules.users.schemas import validate_timezone


def normalize_email(value: str) -> str:
    return value.strip().lower()


class RegisterRequest(InputModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr = Field(max_length=254)
    # Strength rules are checked in the service so all problems are reported together.
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    timezone: str = "UTC"
    accept_terms: Literal[True]

    _normalize_email = field_validator("email", mode="after")(normalize_email)

    @field_validator("timezone")
    @classmethod
    def check_timezone(cls, value: str) -> str:
        return validate_timezone(value)


class LoginRequest(InputModel):
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)

    _normalize_email = field_validator("email", mode="after")(normalize_email)


class ForgotPasswordRequest(InputModel):
    email: EmailStr = Field(max_length=254)

    _normalize_email = field_validator("email", mode="after")(normalize_email)


class ResetPasswordRequest(InputModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class ChangePasswordRequest(InputModel):
    current_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    new_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class MessageResponse(ApiModel):
    message: str


class SessionRead(ApiModel):
    id: int
    created_at: UtcDateTime
    last_seen_at: UtcDateTime
    ip_address: str | None
    user_agent: str | None
    current: bool
