from fastapi import APIRouter, Depends, Request, Response, status

from app.common.mailer import Mailer, get_mailer
from app.modules.auth import service
from app.modules.auth.dependencies import AppSettings, DbSession
from app.modules.auth.schemas import (
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    ResetPasswordRequest,
)
from app.modules.auth.sessions import (
    clear_session_cookies,
    set_csrf_cookie,
    set_session_cookies,
)
from app.modules.auth.tokens import SESSION_COOKIE, csrf_token_for_session, new_token
from app.modules.users.schemas import UserRead

router = APIRouter(prefix="/auth", tags=["auth"])

ANONYMOUS_CSRF_MAX_AGE = 2 * 60 * 60


@router.get("/csrf", status_code=status.HTTP_204_NO_CONTENT)
def issue_csrf_token(request: Request, response: Response, settings: AppSettings) -> None:
    """Issues (or repairs) the CSRF cookie the SPA echoes on unsafe requests.

    With a session cookie present the token is re-derived from that session, so a lost or
    overwritten cookie heals itself; anonymous visitors get a random token.
    """
    session_token = request.cookies.get(SESSION_COOKIE)
    if session_token:
        secret = settings.session_secret.get_secret_value()
        token = csrf_token_for_session(session_token, secret)
        set_csrf_cookie(response, token, settings, settings.session_absolute_minutes * 60)
        return
    set_csrf_cookie(response, new_token(), settings, ANONYMOUS_CSRF_MAX_AGE)


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
) -> UserRead:
    user, issued = service.register(db, payload, request, settings)
    set_session_cookies(response, issued.token, settings)
    return UserRead.model_validate(user)


@router.post("/login", response_model=UserRead)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
) -> UserRead:
    user, issued = service.login(
        db, payload, request, settings, request.cookies.get(SESSION_COOKIE)
    )
    set_session_cookies(response, issued.token, settings)
    return UserRead.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: DbSession, settings: AppSettings) -> None:
    service.logout(db, request.cookies.get(SESSION_COOKIE))
    clear_session_cookies(response, settings)


@router.post(
    "/password/forgot", response_model=MessageResponse, status_code=status.HTTP_202_ACCEPTED
)
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: DbSession,
    settings: AppSettings,
    mailer: Mailer = Depends(get_mailer),
) -> MessageResponse:
    service.request_password_reset(db, payload.email, request, settings, mailer)
    return MessageResponse(
        message="If an account exists for that email, a reset link is on its way."
    )


@router.post("/password/reset", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    payload: ResetPasswordRequest,
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
) -> None:
    service.reset_password(db, payload, request)
    clear_session_cookies(response, settings)
