from datetime import timedelta
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.mailer import OutboxMailer
from app.db.base import utc_now
from app.modules.auth.models import PasswordResetToken, UserSession
from app.modules.auth.tokens import CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, hash_token
from app.modules.users.models import User
from tests.conftest import ApiClient
from tests.factories import DEFAULT_PASSWORD, login, register

# --- Registration ---------------------------------------------------------------------------


def test_register_creates_account_and_signs_in(api: ApiClient, db: Session) -> None:
    response = register(api, email="  Ada@Example.COM ")

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "ada@example.com"
    assert body["timezone"] == "Asia/Kolkata"
    assert body["created_at"].endswith("Z")
    assert "password" not in str(body).lower()

    set_cookie = response.headers.get_list("set-cookie")
    session_cookie = next(c for c in set_cookie if c.startswith(f"{SESSION_COOKIE}="))
    assert "HttpOnly" in session_cookie
    assert "SameSite=lax" in session_cookie
    assert api.get("/api/v1/me").json()["email"] == "ada@example.com"

    user = db.scalar(select(User).where(User.email == "ada@example.com"))
    assert user is not None
    assert user.password_hash.startswith("$argon2id$")
    assert DEFAULT_PASSWORD not in user.password_hash


def test_register_rejects_duplicate_email_case_insensitively(api: ApiClient, make_api) -> None:
    assert register(api).status_code == 201

    response = register(make_api(), email="ADA@example.com")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "email_taken"


def test_register_reports_weak_password_details(api: ApiClient) -> None:
    response = register(api, password="password1234")

    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert details[0]["field"] == "password"
    assert "too common" in details[0]["message"]


def test_register_requires_terms_valid_timezone_and_known_fields(api: ApiClient) -> None:
    assert register(api, accept_terms=False).status_code == 422
    assert register(api, timezone="Mars/Olympus").status_code == 422
    assert register(api, is_platform_admin=True).status_code == 422


# --- CSRF ------------------------------------------------------------------------------------


def test_unsafe_request_without_csrf_token_is_rejected(app, api: ApiClient) -> None:
    from fastapi.testclient import TestClient

    with TestClient(app, raise_server_exceptions=False) as raw:
        response = raw.post("/api/v1/auth/login", json={"email": "a@b.co", "password": "x"})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_failed"


def test_csrf_token_must_be_bound_to_the_session(api: ApiClient) -> None:
    register(api)
    # Overwrite the real cookie (same domain) as a cookie-tossing attacker would.
    api.cookies.set(CSRF_COOKIE, "attacker-chosen-token", domain="testserver.local")

    response = api.post("/api/v1/auth/logout", headers={CSRF_HEADER: "attacker-chosen-token"})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_failed"


# --- Login / logout / session lifecycle ------------------------------------------------------


def test_login_success_and_generic_failures(api: ApiClient, make_api) -> None:
    register(api)
    other = make_api()

    assert login(other).status_code == 200
    wrong_password = login(make_api(), password="not the right password")
    unknown_email = login(make_api(), email="nobody@example.com")

    for response in (wrong_password, unknown_email):
        assert response.status_code == 401
        assert response.json()["error"] == {
            **response.json()["error"],
            "code": "invalid_credentials",
            "message": "Email or password is incorrect.",
        }


def test_login_rotates_any_previous_session(api: ApiClient, db: Session) -> None:
    register(api)
    first_token = api.cookies.get(SESSION_COOKIE)

    login(api)

    assert api.cookies.get(SESSION_COOKIE) != first_token
    old = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(first_token)))
    assert old is not None and old.revoked_at is not None


def test_logout_invalidates_the_session_server_side(api: ApiClient, make_api) -> None:
    register(api)
    stolen_token = api.cookies.get(SESSION_COOKIE)

    assert api.post("/api/v1/auth/logout").status_code == 204
    assert api.get("/api/v1/me").status_code == 401

    replay = make_api()
    replay.cookies.set(SESSION_COOKIE, stolen_token)
    assert replay.get("/api/v1/me").status_code == 401


def test_protected_endpoint_requires_session(api: ApiClient) -> None:
    response = api.get("/api/v1/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


def test_expired_and_idle_sessions_are_rejected(api: ApiClient, db: Session) -> None:
    register(api)
    token_hash = hash_token(api.cookies.get(SESSION_COOKIE))
    record = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash))
    assert record is not None

    record.last_seen_at = utc_now() - timedelta(hours=13)
    db.commit()
    assert api.get("/api/v1/me").status_code == 401

    record.last_seen_at = utc_now()
    record.expires_at = utc_now() - timedelta(seconds=1)
    db.commit()
    assert api.get("/api/v1/me").status_code == 401


def test_deactivated_user_loses_access_and_cannot_sign_in(api: ApiClient, db: Session, make_api):
    register(api)
    user = db.scalar(select(User))
    assert user is not None
    user.is_active = False
    db.commit()

    assert api.get("/api/v1/me").status_code == 401
    assert login(make_api()).status_code == 401


def test_login_is_rate_limited_per_account(api: ApiClient, make_api) -> None:
    register(api)
    attacker = make_api()
    for _ in range(10):
        assert login(attacker, password="wrong password guess").status_code == 401

    response = login(attacker, password="wrong password guess")

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "rate_limited"
    assert int(response.headers["Retry-After"]) > 0


# --- Password reset --------------------------------------------------------------------------


def _reset_token_from(outbox: OutboxMailer) -> str:
    body = outbox.sent[-1].body
    link = next(word for word in body.split() if "/reset-password?" in word)
    return parse_qs(urlparse(link).query)["token"][0]


def test_forgot_password_does_not_reveal_unknown_accounts(api: ApiClient, outbox: OutboxMailer):
    response = api.post("/api/v1/auth/password/forgot", json={"email": "ghost@example.com"})

    assert response.status_code == 202
    assert outbox.sent == []


def test_password_reset_flow_and_single_use(api: ApiClient, make_api, outbox: OutboxMailer) -> None:
    register(api)
    visitor = make_api()
    response = visitor.post("/api/v1/auth/password/forgot", json={"email": "ADA@example.com"})
    assert response.status_code == 202
    assert len(outbox.sent) == 1
    assert outbox.sent[0].to == "ada@example.com"
    token = _reset_token_from(outbox)

    new_password = "a brand new passphrase"
    reset = visitor.post(
        "/api/v1/auth/password/reset", json={"token": token, "password": new_password}
    )
    assert reset.status_code == 204

    # Existing sessions were signed out everywhere.
    assert api.get("/api/v1/me").status_code == 401
    # Old password no longer works; new one does.
    assert login(make_api()).status_code == 401
    assert login(make_api(), password=new_password).status_code == 200
    # The link cannot be reused.
    reuse = visitor.post(
        "/api/v1/auth/password/reset", json={"token": token, "password": "yet another passphrase"}
    )
    assert reuse.status_code == 400
    assert reuse.json()["error"]["code"] == "invalid_token"


def test_reset_token_expires_and_only_newest_link_works(
    api: ApiClient, db: Session, outbox: OutboxMailer
) -> None:
    register(api)
    api.post("/api/v1/auth/password/forgot", json={"email": "ada@example.com"})
    first = _reset_token_from(outbox)
    api.post("/api/v1/auth/password/forgot", json={"email": "ada@example.com"})
    second = _reset_token_from(outbox)

    stale = api.post(
        "/api/v1/auth/password/reset", json={"token": first, "password": "a brand new passphrase"}
    )
    assert stale.status_code == 400

    record = db.scalar(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(second))
    )
    assert record is not None
    record.expires_at = utc_now() - timedelta(seconds=1)
    db.commit()
    expired = api.post(
        "/api/v1/auth/password/reset", json={"token": second, "password": "a brand new passphrase"}
    )
    assert expired.status_code == 400


def test_reset_rejects_weak_password_and_keeps_token_usable(
    api: ApiClient, outbox: OutboxMailer
) -> None:
    register(api)
    api.post("/api/v1/auth/password/forgot", json={"email": "ada@example.com"})
    token = _reset_token_from(outbox)

    weak = api.post("/api/v1/auth/password/reset", json={"token": token, "password": "short"})
    assert weak.status_code == 422

    ok = api.post(
        "/api/v1/auth/password/reset", json={"token": token, "password": "a brand new passphrase"}
    )
    assert ok.status_code == 204


def test_csrf_endpoint_repairs_a_lost_session_bound_token(api: ApiClient) -> None:
    register(api)
    api.cookies.delete(CSRF_COOKIE)

    assert api.get("/api/v1/auth/csrf").status_code == 204
    assert api.post("/api/v1/auth/logout").status_code == 204
