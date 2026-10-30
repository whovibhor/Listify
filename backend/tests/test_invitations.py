from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.mailer import OutboxMailer
from app.db.base import utc_now
from app.modules.auth.tokens import hash_token
from app.modules.memberships.models import OrganizationInvitation
from tests.conftest import ApiClient
from tests.factories import create_org, departments_of, register, request_to_join


@pytest.fixture
def owner(api: ApiClient) -> ApiClient:
    register(api, email="owner@example.com", name="Olivia Owner")
    return api


def _invite(owner: ApiClient, org_id: int, **fields) -> dict:
    response = owner.post(f"/api/v1/organizations/{org_id}/invitations", json=fields)
    assert response.status_code == 201, response.text
    return response.json()


def _token(invitation: dict) -> str:
    return invitation["link"].rsplit("/", 1)[1]


def _user(make_api, email: str, name: str = "New Person") -> ApiClient:
    client = make_api()
    assert register(client, email=email, name=name).status_code == 201
    return client


def test_email_invitation_flow(owner: ApiClient, make_api, outbox: OutboxMailer, db: Session):
    org = create_org(owner, "Private Co", discoverable=False)
    sales = departments_of(owner, org["id"])["Sales"]

    invitation = _invite(
        owner, org["id"], email="New.Hire@Example.com", role_key="team_lead", department_id=sales
    )

    assert invitation["status"] == "pending" and invitation["email"] == "new.hire@example.com"
    assert outbox.sent[-1].to == "new.hire@example.com"
    assert invitation["link"] in outbox.sent[-1].body
    # The database only ever holds a hash of the token.
    stored = db.scalar(select(OrganizationInvitation))
    assert stored is not None and stored.token_hash == hash_token(_token(invitation))
    assert _token(invitation) not in str(
        owner.get(f"/api/v1/organizations/{org['id']}/invitations").json()
    )

    newcomer = _user(make_api, "new.hire@example.com")
    preview = newcomer.get(f"/api/v1/invitations/{_token(invitation)}").json()
    assert preview["organization_name"] == "Private Co"
    assert preview["department_name"] == "Sales" and preview["role_name"] == "Team Lead"

    accepted = newcomer.post(f"/api/v1/invitations/{_token(invitation)}/accept")
    assert accepted.status_code == 200 and accepted.json() == {"organization_id": org["id"]}
    mine = newcomer.get("/api/v1/me/organizations").json()[0]
    assert mine["role_keys"] == ["member", "team_lead"]
    assert mine["department_ids"] == [sales]


def test_invitation_is_single_use(owner: ApiClient, make_api) -> None:
    org = create_org(owner)
    token = _token(_invite(owner, org["id"]))

    assert (
        _user(make_api, "a@example.com").post(f"/api/v1/invitations/{token}/accept").status_code
        == 200
    )
    second = _user(make_api, "b@example.com")
    reused = second.post(f"/api/v1/invitations/{token}/accept")
    assert reused.status_code == 400
    assert reused.json()["error"]["code"] == "invitation_invalid"
    assert second.get("/api/v1/me/organizations").json() == []


def test_invitation_for_another_email_is_refused(owner: ApiClient, make_api) -> None:
    org = create_org(owner)
    token = _token(_invite(owner, org["id"], email="right@example.com"))
    wrong = _user(make_api, "wrong@example.com")

    assert wrong.get(f"/api/v1/invitations/{token}").status_code == 403
    response = wrong.post(f"/api/v1/invitations/{token}/accept")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "invitation_email_mismatch"


def test_expired_and_revoked_invitations_are_refused(
    owner: ApiClient, make_api, db: Session
) -> None:
    org = create_org(owner)
    expired = _invite(owner, org["id"])
    revoked = _invite(owner, org["id"])
    record = db.get(OrganizationInvitation, expired["id"])
    assert record is not None
    record.expires_at = utc_now() - timedelta(seconds=1)
    db.commit()
    url = f"/api/v1/organizations/{org['id']}/invitations"
    assert owner.delete(f"{url}/{revoked['id']}").status_code == 204
    assert owner.delete(f"{url}/{revoked['id']}").status_code == 409

    newcomer = _user(make_api, "n@example.com")
    for invitation in (expired, revoked):
        assert newcomer.post(f"/api/v1/invitations/{_token(invitation)}/accept").status_code == 400
    statuses = {i["id"]: i["status"] for i in owner.get(url).json()}
    assert statuses == {expired["id"]: "expired", revoked["id"]: "revoked"}


def test_invitations_require_authentication_and_valid_roles(
    owner: ApiClient, make_api, app
) -> None:
    org = create_org(owner)
    url = f"/api/v1/organizations/{org['id']}/invitations"

    assert owner.post(url, json={"role_key": "owner"}).status_code == 422
    assert owner.post(url, json={"role_key": "department_manager"}).status_code == 422  # needs dept
    assert owner.post(url, json={"expires_in_days": 90}).status_code == 422
    assert make_api().get(f"/api/v1/invitations/{'x' * 43}").status_code == 401


def test_invitation_settles_a_pending_request(owner: ApiClient, make_api) -> None:
    org = create_org(owner)
    sales = departments_of(owner, org["id"])["Sales"]
    person = _user(make_api, "p@example.com")
    assert request_to_join(person, org["id"], sales).status_code == 201
    token = _token(_invite(owner, org["id"], email="p@example.com", department_id=sales))

    assert person.post(f"/api/v1/invitations/{token}/accept").status_code == 200

    assert person.get("/api/v1/me/membership-requests").json()[0]["status"] == "cancelled"
    assert person.post(f"/api/v1/invitations/{token}/accept").status_code == 400


def test_existing_member_cannot_accept_again(owner: ApiClient) -> None:
    org = create_org(owner)
    token = _token(_invite(owner, org["id"]))
    response = owner.post(f"/api/v1/invitations/{token}/accept")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "already_member"
