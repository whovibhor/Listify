from typing import Any

from fastapi.testclient import TestClient

DEFAULT_PASSWORD = "correct horse battery staple"


def register(
    client: TestClient,
    *,
    email: str = "ada@example.com",
    name: str = "Ada Lovelace",
    password: str = DEFAULT_PASSWORD,
    timezone: str = "Asia/Kolkata",
    **overrides: Any,
) -> Any:
    payload = {
        "name": name,
        "email": email,
        "password": password,
        "timezone": timezone,
        "accept_terms": True,
        **overrides,
    }
    return client.post("/api/v1/auth/register", json=payload)


def login(client: TestClient, email: str = "ada@example.com", password: str = DEFAULT_PASSWORD):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def create_task(client: TestClient, title: str = "Write report", **fields: Any) -> dict[str, Any]:
    response = client.post("/api/v1/me/tasks", json={"title": title, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def create_tag(client: TestClient, name: str = "work", color: str = "blue") -> dict[str, Any]:
    response = client.post("/api/v1/me/tags", json={"name": name, "color": color})
    assert response.status_code == 201, response.text
    return response.json()


def list_tasks(client: TestClient, **params: Any) -> dict[str, Any]:
    response = client.get("/api/v1/me/tasks", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def titles(page: dict[str, Any]) -> list[str]:
    return [item["title"] for item in page["items"]]


def create_org(
    client: TestClient,
    name: str = "Acme",
    *,
    departments: tuple[str, ...] = ("Engineering", "Sales"),
    discoverable: bool = True,
    **fields: Any,
) -> dict[str, Any]:
    response = client.post(
        "/api/v1/organizations",
        json={
            "name": name,
            "is_discoverable": discoverable,
            "departments": [{"name": department} for department in departments],
            **fields,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def departments_of(client: TestClient, org_id: int) -> dict[str, int]:
    response = client.get(f"/api/v1/organizations/{org_id}/departments")
    assert response.status_code == 200, response.text
    return {department["name"]: department["id"] for department in response.json()}


def request_to_join(client: TestClient, org_id: int, department_id: int | None, **fields: Any):
    return client.post(
        f"/api/v1/organizations/{org_id}/membership-requests",
        json={"department_id": department_id, **fields},
    )


def join_as(
    owner: TestClient,
    applicant: TestClient,
    org_id: int,
    department_id: int,
    *,
    role_key: str = "member",
) -> dict[str, Any]:
    """Runs the whole request → approve flow and returns the created request."""
    created = request_to_join(applicant, org_id, department_id)
    assert created.status_code == 201, created.text
    approved = owner.post(
        f"/api/v1/organizations/{org_id}/membership-requests/{created.json()['id']}/approve",
        json={"role_key": role_key},
    )
    assert approved.status_code == 200, approved.text
    return created.json()
