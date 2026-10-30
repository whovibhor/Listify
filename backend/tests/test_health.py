import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.health.service import DependencyStatus, get_database_probe, probe_database


def test_health_ok_when_database_reachable(app: FastAPI, client: TestClient) -> None:
    app.dependency_overrides[get_database_probe] = lambda: (
        lambda: DependencyStatus(status="ok", latency_ms=1.2)
    )

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["environment"] == "test"
    assert body["checks"]["database"] == {"status": "ok", "latency_ms": 1.2}


def test_health_degraded_and_503_when_database_down(app: FastAPI, client: TestClient) -> None:
    app.dependency_overrides[get_database_probe] = lambda: lambda: DependencyStatus(status="error")

    response = client.get("/api/v1/health")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["checks"]["database"]["status"] == "error"


def test_health_does_not_leak_connection_details(app: FastAPI, client: TestClient) -> None:
    app.dependency_overrides[get_database_probe] = lambda: lambda: DependencyStatus(status="error")

    text = client.get("/api/v1/health").text.lower()

    for secret_hint in ("password", "3306", "pymysql", "traceback", "listify_app"):
        assert secret_hint not in text


@pytest.mark.db
def test_real_database_probe() -> None:
    """Integration check against the MySQL configured in backend/.env."""
    result = probe_database()
    if result.status != "ok":
        pytest.skip("MySQL not reachable with current backend/.env settings")
    assert result.latency_ms is not None
