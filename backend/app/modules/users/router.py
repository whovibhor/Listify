from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.exceptions import NotFoundError
from app.db.base import utc_now
from app.modules.auth import service as auth_service
from app.modules.auth.dependencies import CurrentAuth, DbSession
from app.modules.auth.models import UserSession
from app.modules.auth.schemas import ChangePasswordRequest, SessionRead
from app.modules.users.models import UserPreferences
from app.modules.users.schemas import PreferencesRead, PreferencesUpdate, UserRead, UserUpdate

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserRead)
def read_me(auth: CurrentAuth) -> UserRead:
    return UserRead.model_validate(auth.user)


@router.patch("", response_model=UserRead)
def update_me(payload: UserUpdate, auth: CurrentAuth, db: DbSession) -> UserRead:
    user = auth.user
    for field, value in payload.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(user, field, value)
    db.commit()
    return UserRead.model_validate(user)


@router.patch("/preferences", response_model=PreferencesRead)
def update_preferences(
    payload: PreferencesUpdate, auth: CurrentAuth, db: DbSession
) -> PreferencesRead:
    user = auth.user
    if user.preferences is None:
        user.preferences = UserPreferences(user_id=user.id, theme=payload.theme)
    else:
        user.preferences.theme = payload.theme
    db.commit()
    return PreferencesRead(theme=user.theme)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(payload: ChangePasswordRequest, auth: CurrentAuth, db: DbSession) -> None:
    auth_service.change_password(db, auth, payload)


@router.get("/sessions", response_model=list[SessionRead])
def list_sessions(auth: CurrentAuth, db: DbSession) -> list[SessionRead]:
    sessions = db.scalars(
        select(UserSession)
        .where(
            UserSession.user_id == auth.user.id,
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > utc_now(),
        )
        .order_by(UserSession.last_seen_at.desc())
    ).all()
    return [
        SessionRead.model_validate(
            {
                "id": s.id,
                "created_at": s.created_at,
                "last_seen_at": s.last_seen_at,
                "ip_address": s.ip_address,
                "user_agent": s.user_agent,
                "current": s.id == auth.session.id,
            }
        )
        for s in sessions
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(session_id: int, auth: CurrentAuth, db: DbSession) -> None:
    # Scoped to the caller: another user's session ID is indistinguishable from a missing one.
    record = db.scalar(
        select(UserSession).where(
            UserSession.id == session_id,
            UserSession.user_id == auth.user.id,
            UserSession.revoked_at.is_(None),
        )
    )
    if record is None:
        raise NotFoundError("Session not found.")
    record.revoked_at = utc_now()
    db.commit()
