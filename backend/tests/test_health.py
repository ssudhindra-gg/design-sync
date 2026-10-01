import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.store import InMemoryStore


def test_health_reports_ok_database_and_version(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_VERSION", "abc123")
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok", "version": "abc123"}


def test_health_version_defaults_to_dev(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APP_VERSION", raising=False)
    assert client.get("/api/health").json()["version"] == "dev"


def test_health_is_503_without_leaking_the_error(
    client: TestClient, store: InMemoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unreachable() -> None:
        raise OperationalError("SELECT 1", {}, Exception("password authentication failed for user sdip"))

    monkeypatch.setattr(store, "ping", unreachable)
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json()["status"] == "error"
    assert response.json()["database"] == "unavailable"
    assert "password" not in response.text


def test_ping_succeeds_against_a_real_engine(store: InMemoryStore) -> None:
    store.ping()
