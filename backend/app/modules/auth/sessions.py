from dataclasses import dataclass
from datetime import timedelta

from fastapi import Request, Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.base import utc_now
from app.modules.auth.models import UserSession
from app.modules.auth.tokens import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    csrf_token_for_session,
    hash_token,
    new_token,
)
from app.modules.users.models import User

# Avoid a write on every request; activity is tracked at this granularity.
LAST_SEEN_RESOLUTION = timedelta(minutes=5)


@dataclass
class AuthContext:
    user: User
    session: UserSession


@dataclass(frozen=True)
class IssuedSession:
    record: UserSession
    token: str


def client_ip(request: Request) -> str | None:
    # Behind Nginx this becomes the trusted X-Forwarded-For value (configured in Phase 9).
    return request.client.host if request.client else None


def create_session(db: Session, user: User, request: Request, settings: Settings) -> IssuedSession:
    token = new_token()
    now = utc_now()
    record = UserSession(
        user_id=user.id,
        token_hash=hash_token(token),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(minutes=settings.session_absolute_minutes),
        ip_address=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:255] or None,
    )
    db.add(record)
    return IssuedSession(record=record, token=token)


def resolve_session(db: Session, token: str | None, settings: Settings) -> AuthContext | None:
    """Returns the live session for a cookie token, or None if missing, expired, idle or revoked."""
    if not token:
        return None
    now = utc_now()
    record = db.scalar(
        select(UserSession).where(
            UserSession.token_hash == hash_token(token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > now,
            UserSession.last_seen_at > now - timedelta(minutes=settings.session_idle_minutes),
        )
    )
    if record is None or not record.user.is_active:
        return None
    if now - record.last_seen_at > LAST_SEEN_RESOLUTION:
        record.last_seen_at = now
        db.commit()
    return AuthContext(user=record.user, session=record)


def revoke_session(db: Session, token: str | None) -> None:
    if not token:
        return
    db.execute(
        update(UserSession)
        .where(UserSession.token_hash == hash_token(token), UserSession.revoked_at.is_(None))
        .values(revoked_at=utc_now())
    )


def revoke_user_sessions(db: Session, user_id: int, *, except_session_id: int | None = None) -> int:
    statement = update(UserSession).where(
        UserSession.user_id == user_id, UserSession.revoked_at.is_(None)
    )
    if except_session_id is not None:
        statement = statement.where(UserSession.id != except_session_id)
    result = db.execute(statement.values(revoked_at=utc_now()))
    return result.rowcount  # type: ignore[attr-defined, no-any-return]


def set_session_cookies(response: Response, token: str, settings: Settings) -> None:
    max_age = settings.session_absolute_minutes * 60
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max_age,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )
    set_csrf_cookie(response, csrf_token_for_session(token, _secret(settings)), settings, max_age)


def set_csrf_cookie(response: Response, value: str, settings: Settings, max_age: int) -> None:
    # Readable by the SPA so it can echo the value in the X-CSRF-Token header.
    response.set_cookie(
        CSRF_COOKIE,
        value,
        max_age=max_age,
        httponly=False,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )


def clear_session_cookies(response: Response, settings: Settings) -> None:
    for name, http_only in ((SESSION_COOKIE, True), (CSRF_COOKIE, False)):
        response.delete_cookie(
            name, path="/", secure=settings.secure_cookies, httponly=http_only, samesite="lax"
        )


def _secret(settings: Settings) -> str:
    return settings.session_secret.get_secret_value()
