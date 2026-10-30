import logging
from datetime import timedelta
from urllib.parse import urlencode

from fastapi import Request
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.common import rate_limit
from app.common.mailer import EmailMessage, Mailer
from app.core.config import Settings
from app.core.exceptions import AppError, ConflictError, UnauthenticatedError
from app.db.base import utc_now
from app.modules.auth import passwords
from app.modules.auth.models import PasswordResetToken
from app.modules.auth.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
)
from app.modules.auth.sessions import (
    AuthContext,
    IssuedSession,
    client_ip,
    create_session,
    revoke_session,
    revoke_user_sessions,
)
from app.modules.auth.tokens import hash_token, new_token
from app.modules.users.models import User

logger = logging.getLogger("workpulse.auth")

LOGIN_PER_ACCOUNT = rate_limit.RateLimit("login:account", 10, timedelta(minutes=15))
LOGIN_PER_IP = rate_limit.RateLimit("login:ip", 50, timedelta(minutes=15))
REGISTER_PER_IP = rate_limit.RateLimit("register:ip", 10, timedelta(hours=1))
FORGOT_PER_IP = rate_limit.RateLimit("forgot:ip", 10, timedelta(hours=1))
FORGOT_PER_ACCOUNT = rate_limit.RateLimit("forgot:account", 3, timedelta(hours=1))
RESET_PER_IP = rate_limit.RateLimit("reset:ip", 20, timedelta(hours=1))
CHANGE_PASSWORD_PER_USER = rate_limit.RateLimit("password-change:user", 10, timedelta(hours=1))


class InvalidCredentialsError(UnauthenticatedError):
    code = "invalid_credentials"


class EmailTakenError(ConflictError):
    code = "email_taken"


class WeakPasswordError(AppError):
    status_code = 422
    code = "validation_error"

    def __init__(self, problems: list[str], field: str) -> None:
        super().__init__(
            "Choose a stronger password.",
            details=[{"field": field, "message": problem} for problem in problems],
        )


class InvalidResetTokenError(AppError):
    status_code = 400
    code = "invalid_token"


def _ensure_strong(password: str, *, email: str, name: str = "", field: str = "password") -> None:
    if problems := passwords.password_problems(password, email=email, name=name):
        raise WeakPasswordError(problems, field)


def register(
    db: Session, payload: RegisterRequest, request: Request, settings: Settings
) -> tuple[User, IssuedSession]:
    rate_limit.hit(db, REGISTER_PER_IP, client_ip(request) or "unknown")
    _ensure_strong(payload.password, email=payload.email, name=payload.name)
    if db.scalar(select(User.id).where(User.email == payload.email)) is not None:
        raise EmailTakenError("An account with this email already exists. Try signing in.")

    now = utc_now()
    user = User(
        email=payload.email,
        name=payload.name,
        password_hash=passwords.hash_password(payload.password),
        timezone=payload.timezone,
        terms_accepted_at=now,
        password_changed_at=now,
        last_login_at=now,
    )
    db.add(user)
    try:
        db.flush()  # assigns user.id; the unique index catches a concurrent duplicate
    except IntegrityError as exc:
        db.rollback()
        raise EmailTakenError("An account with this email already exists. Try signing in.") from exc
    issued = create_session(db, user, request, settings)
    db.commit()
    logger.info("User registered", extra={"extra_fields": {"user_id": user.id}})
    return user, issued


def login(
    db: Session,
    payload: LoginRequest,
    request: Request,
    settings: Settings,
    previous_session_token: str | None,
) -> tuple[User, IssuedSession]:
    ip = client_ip(request) or "unknown"
    rate_limit.hit(db, LOGIN_PER_IP, ip)
    rate_limit.hit(db, LOGIN_PER_ACCOUNT, payload.email)

    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None:
        passwords.burn_verification_time(payload.password)
        raise InvalidCredentialsError("Email or password is incorrect.")
    if not passwords.verify_password(user.password_hash, payload.password) or not user.is_active:
        raise InvalidCredentialsError("Email or password is incorrect.")

    if passwords.needs_rehash(user.password_hash):
        user.password_hash = passwords.hash_password(payload.password)
    # Session fixation defence: never reuse a session that existed before authentication.
    revoke_session(db, previous_session_token)
    issued = create_session(db, user, request, settings)
    user.last_login_at = utc_now()
    db.commit()
    return user, issued


def logout(db: Session, session_token: str | None) -> None:
    revoke_session(db, session_token)
    db.commit()


def request_password_reset(
    db: Session, email: str, request: Request, settings: Settings, mailer: Mailer
) -> None:
    """Always succeeds from the caller's point of view so account existence is not revealed."""
    ip = client_ip(request)
    rate_limit.hit(db, FORGOT_PER_IP, ip or "unknown")
    rate_limit.hit(db, FORGOT_PER_ACCOUNT, email)

    user = db.scalar(select(User).where(User.email == email, User.is_active.is_(True)))
    if user is None:
        return

    now = utc_now()
    # Only the newest link works.
    db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=now)
    )
    token = new_token()
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(token),
            created_at=now,
            expires_at=now + timedelta(minutes=settings.password_reset_ttl_minutes),
            requested_ip=ip,
        )
    )
    db.commit()

    link = f"{settings.frontend_base_url.rstrip('/')}/reset-password?{urlencode({'token': token})}"
    mailer.send(
        EmailMessage(
            to=user.email,
            subject="Reset your WorkPulse password",
            body=(
                f"Hi {user.name},\n\nUse this link to choose a new password. It expires in "
                f"{settings.password_reset_ttl_minutes} minutes and can be used once:\n\n{link}\n\n"
                "If you didn't ask for this, you can ignore this email."
            ),
        )
    )


def reset_password(db: Session, payload: ResetPasswordRequest, request: Request) -> None:
    rate_limit.hit(db, RESET_PER_IP, client_ip(request) or "unknown")
    now = utc_now()
    record = db.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == hash_token(payload.token),
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
    )
    if record is None or not record.user.is_active:
        raise InvalidResetTokenError(
            "This reset link is invalid or has expired. Request a new one."
        )
    user = record.user
    _ensure_strong(payload.password, email=user.email, name=user.name)

    user.password_hash = passwords.hash_password(payload.password)
    user.password_changed_at = now
    record.used_at = now
    revoke_user_sessions(db, user.id)  # sign out everywhere after a reset
    db.commit()
    logger.info("Password reset completed", extra={"extra_fields": {"user_id": user.id}})


def change_password(db: Session, auth: AuthContext, payload: ChangePasswordRequest) -> None:
    user = auth.user
    rate_limit.hit(db, CHANGE_PASSWORD_PER_USER, str(user.id))
    if not passwords.verify_password(user.password_hash, payload.current_password):
        raise WeakPasswordError(["Current password is incorrect."], "current_password")
    _ensure_strong(payload.new_password, email=user.email, name=user.name, field="new_password")

    user.password_hash = passwords.hash_password(payload.new_password)
    user.password_changed_at = utc_now()
    revoke_user_sessions(db, user.id, except_session_id=auth.session.id)
    db.commit()
