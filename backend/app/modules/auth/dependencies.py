from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.exceptions import ForbiddenError, UnauthenticatedError
from app.db.session import get_db
from app.modules.auth.sessions import AuthContext, resolve_session
from app.modules.auth.tokens import (
    CSRF_COOKIE,
    CSRF_HEADER,
    SESSION_COOKIE,
    csrf_token_for_session,
    tokens_match,
)

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class CsrfError(ForbiddenError):
    code = "csrf_failed"


def csrf_protect(request: Request, settings: Settings = Depends(get_settings)) -> None:
    """Double-submit CSRF check for every unsafe API request (ADR-006).

    The header must equal the `listify_csrf` cookie. When a session cookie is present the
    token must also be the HMAC bound to that session, so a planted cookie is useless.
    """
    if request.method in SAFE_METHODS:
        return
    cookie = request.cookies.get(CSRF_COOKIE)
    header = request.headers.get(CSRF_HEADER)
    if not tokens_match(cookie, header):
        raise CsrfError("Security token missing or invalid. Refresh the page and try again.")
    session_token = request.cookies.get(SESSION_COOKIE)
    if session_token:
        expected = csrf_token_for_session(session_token, settings.session_secret.get_secret_value())
        if not tokens_match(cookie, expected):
            raise CsrfError("Security token missing or invalid. Refresh the page and try again.")


def get_optional_auth(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AuthContext | None:
    return resolve_session(db, request.cookies.get(SESSION_COOKIE), settings)


def get_auth(auth: AuthContext | None = Depends(get_optional_auth)) -> AuthContext:
    if auth is None:
        raise UnauthenticatedError("Please sign in to continue.")
    return auth


CurrentAuth = Annotated[AuthContext, Depends(get_auth)]
OptionalAuth = Annotated[AuthContext | None, Depends(get_optional_auth)]
DbSession = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]
