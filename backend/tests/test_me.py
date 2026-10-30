from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.auth.models import UserSession
from app.modules.users.models import UserPreferences
from tests.conftest import ApiClient
from tests.factories import DEFAULT_PASSWORD, login, register


def test_update_profile_name_and_timezone(api: ApiClient) -> None:
    register(api)

    response = api.patch("/api/v1/me", json={"name": "  Ada King ", "timezone": "Europe/London"})

    assert response.status_code == 200
    assert response.json()["name"] == "Ada King"
    assert response.json()["timezone"] == "Europe/London"
    assert api.get("/api/v1/me").json()["timezone"] == "Europe/London"


def test_profile_update_validates_input_and_rejects_protected_fields(api: ApiClient) -> None:
    register(api)

    assert api.patch("/api/v1/me", json={"timezone": "Nowhere/City"}).status_code == 422
    assert api.patch("/api/v1/me", json={"name": ""}).status_code == 422
    assert api.patch("/api/v1/me", json={"email": "evil@example.com"}).status_code == 422
    assert api.get("/api/v1/me").json()["email"] == "ada@example.com"


def test_change_password_keeps_current_session_and_signs_out_others(
    api: ApiClient, make_api
) -> None:
    register(api)
    other_device = make_api()
    login(other_device)

    wrong = api.post(
        "/api/v1/me/password",
        json={"current_password": "not my password", "new_password": "a brand new passphrase"},
    )
    assert wrong.status_code == 422
    assert wrong.json()["error"]["details"][0]["field"] == "current_password"

    ok = api.post(
        "/api/v1/me/password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "a brand new passphrase"},
    )
    assert ok.status_code == 204
    assert api.get("/api/v1/me").status_code == 200
    assert other_device.get("/api/v1/me").status_code == 401
    assert login(make_api(), password="a brand new passphrase").status_code == 200


def test_list_and_revoke_sessions(api: ApiClient, make_api, db: Session) -> None:
    register(api)
    laptop = make_api()
    login(laptop)

    sessions = api.get("/api/v1/me/sessions").json()
    assert len(sessions) == 2
    assert [s["current"] for s in sessions].count(True) == 1
    other_id = next(s["id"] for s in sessions if not s["current"])

    assert api.delete(f"/api/v1/me/sessions/{other_id}").status_code == 204
    assert laptop.get("/api/v1/me").status_code == 401
    assert len(api.get("/api/v1/me/sessions").json()) == 1


def test_cannot_revoke_another_users_session(api: ApiClient, make_api, db: Session) -> None:
    register(api)
    mallory = make_api()
    register(mallory, email="mallory@example.com", name="Mallory")
    victim_session = db.scalar(
        select(UserSession)
        .join(UserSession.user)
        .where(UserSession.user.has(email="ada@example.com"))
    )
    assert victim_session is not None

    response = mallory.delete(f"/api/v1/me/sessions/{victim_session.id}")

    assert response.status_code == 404
    assert api.get("/api/v1/me").status_code == 200


def test_theme_preference_is_stored_and_follows_the_user(api: ApiClient, make_api, db: Session):
    register(api)
    assert api.get("/api/v1/me").json()["theme"] == "system"  # default before any choice

    assert api.patch("/api/v1/me/preferences", json={"theme": "dark"}).json() == {"theme": "dark"}
    assert api.patch("/api/v1/me/preferences", json={"theme": "neon"}).status_code == 422

    # Another device sees the saved choice straight from the database.
    laptop = make_api()
    login(laptop)
    assert laptop.get("/api/v1/me").json()["theme"] == "dark"
    row = db.scalar(select(UserPreferences))
    assert row is not None and row.theme == "dark"
