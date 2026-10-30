from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel


def test_unknown_route_uses_error_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert error["request_id"] == response.headers["X-Request-ID"]


def test_validation_errors_are_structured(app: FastAPI, client: TestClient) -> None:
    class Payload(BaseModel):
        title: str

    @app.post("/api/v1/_test/validate")
    def validate(payload: Payload) -> dict[str, str]:
        return {"title": payload.title}

    response = client.post("/api/v1/_test/validate", json={})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"][0]["field"] == "title"


def test_unhandled_exception_hides_internals(app: FastAPI, client: TestClient) -> None:
    @app.get("/api/v1/_test/boom")
    def boom() -> None:
        raise RuntimeError("db password is hunter2")

    response = client.get("/api/v1/_test/boom")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "hunter2" not in response.text


def test_request_id_is_echoed_when_safe(client: TestClient) -> None:
    response = client.get("/api/v1/does-not-exist", headers={"X-Request-ID": "abc-123"})
    assert response.headers["X-Request-ID"] == "abc-123"


def test_unsafe_request_id_is_replaced(client: TestClient) -> None:
    response = client.get("/api/v1/does-not-exist", headers={"X-Request-ID": "bad id\n<script>"})
    assert response.headers["X-Request-ID"] != "bad id\n<script>"
    assert len(response.headers["X-Request-ID"]) == 32


def test_cors_allows_only_configured_origin(client: TestClient) -> None:
    allowed = client.options(
        "/api/v1/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    denied = client.options(
        "/api/v1/health",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )

    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert allowed.headers.get("access-control-allow-credentials") == "true"
    assert "access-control-allow-origin" not in denied.headers
