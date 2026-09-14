from fastapi.testclient import TestClient

from app.store import InMemoryStore

from .conftest import create_room, login


def test_passwords_are_hashed_and_login_issues_bearer_token(client: TestClient, store: InMemoryStore) -> None:
    password_hash = store.accounts["interviewer@example.com"].password_hash
    assert password_hash.startswith("scrypt$")
    assert "demo-password" not in password_hash

    assert client.post("/api/auth/login", json={"username": "interviewer@example.com", "password": "wrong"}).status_code == 401
    response = client.post(
        "/api/auth/login",
        json={"username": "interviewer@example.com", "password": "demo-password"},
    )
    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"
    assert response.json()["access_token"]


def test_session_creation_requires_account_authentication(client: TestClient) -> None:
    response = client.post("/api/sessions", json={"title": "Nope", "hostName": "Host"})
    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


def test_seeded_session_is_available_to_public_join_page(client: TestClient) -> None:
    response = client.get("/api/sessions/demo-session")
    assert response.status_code == 200
    body = response.json()
    assert body["session"]["title"] == "Distributed notifications interview"
    assert len(body["diagram"]["nodes"]) == 4
    assert body["notes"]["privateNotes"] == ""


def test_create_and_join_issue_scoped_session_cookies(app, store: InMemoryStore) -> None:
    host = TestClient(app)
    guest = TestClient(app)
    try:
        session_id, host_id = create_room(host)
        assert "ParticipantSession" in host.cookies

        joined = guest.post(
            f"/api/sessions/{session_id}/participants",
            json={"name": "Candidate User", "role": "guest"},
        )
        assert joined.status_code == 201
        assert joined.json()["status"] == "waiting"
        assert "ParticipantSession" in guest.cookies

        public = guest.get(f"/api/sessions/{session_id}")
        assert public.status_code == 200
        assert any(p["id"] == host_id for p in public.json()["participants"])
        assert public.json()["notes"]["privateNotes"] == ""
    finally:
        host.close()
        guest.close()


def test_invalid_session_returns_contract_error(client: TestClient) -> None:
    response = client.get("/api/sessions/missing")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
