from fastapi.testclient import TestClient

from .conftest import create_room, login


def admit_guest(host: TestClient, guest: TestClient, session_id: str) -> str:
    joined = guest.post(
        f"/api/sessions/{session_id}/participants",
        json={"name": "Candidate User", "role": "guest"},
    )
    participant_id = joined.json()["id"]
    response = host.patch(
        f"/api/sessions/{session_id}/participants/{participant_id}/status",
        json={"status": "admitted"},
    )
    assert response.status_code == 200
    return participant_id


def test_waiting_room_presence_chat_and_private_notes(app) -> None:
    host = TestClient(app)
    guest = TestClient(app)
    try:
        session_id, _ = create_room(host)
        guest_id = admit_guest(host, guest, session_id)

        presence = guest.patch(
            f"/api/sessions/{session_id}/participants/{guest_id}/presence",
            json={"audioConnected": True, "muted": False},
        )
        assert presence.status_code == 200
        assert next(p for p in presence.json() if p["id"] == guest_id)["audioConnected"] is True

        message = guest.post(
            f"/api/sessions/{session_id}/messages",
            json={"authorId": guest_id, "authorName": "Spoofed", "body": "Hello room"},
        )
        assert message.status_code == 201
        assert message.json()["authorName"] == "Candidate User"

        host_notes = host.patch(
            f"/api/sessions/{session_id}/notes",
            json={"shared": "Agree on retries.", "privateNotes": "Probe failure isolation."},
        )
        assert host_notes.status_code == 200
        assert host_notes.json()["privateNotes"] == "Probe failure isolation."

        guest_view = guest.get(f"/api/sessions/{session_id}")
        assert guest_view.json()["notes"]["privateNotes"] == ""
        forbidden = guest.patch(
            f"/api/sessions/{session_id}/notes",
            json={"privateNotes": "I should not be able to write this."},
        )
        assert forbidden.status_code == 403
    finally:
        host.close()
        guest.close()


def test_diagram_lock_pause_and_snapshots(app) -> None:
    host = TestClient(app)
    guest = TestClient(app)
    try:
        session_id, _ = create_room(host)
        guest_id = admit_guest(host, guest, session_id)
        diagram = {
            "nodes": [
                {"id": "api", "kind": "service", "label": "API", "x": 1, "y": 2, "w": 100, "h": 80},
                {"id": "db", "kind": "database", "label": "DB", "x": 200, "y": 2, "w": 100, "h": 80},
            ],
            "edges": [{"id": "edge", "from": "api", "to": "db", "label": "SQL"}],
        }
        saved = guest.put(f"/api/sessions/{session_id}/diagram", json=diagram)
        assert saved.status_code == 200

        locked = host.patch(
            f"/api/sessions/{session_id}/diagram/nodes/api/lock",
            json={"locked": True},
        )
        assert locked.status_code == 200
        changed_locked = {**diagram, "nodes": [{**diagram["nodes"][0], "label": "Changed"}, diagram["nodes"][1]]}
        assert guest.put(f"/api/sessions/{session_id}/diagram", json=changed_locked).status_code == 403

        paused = host.patch(f"/api/sessions/{session_id}", json={"editingPaused": True})
        assert paused.status_code == 200
        assert guest.put(f"/api/sessions/{session_id}/diagram", json=diagram).status_code == 403
        assert host.patch(f"/api/sessions/{session_id}", json={"editingPaused": False}).status_code == 200

        created = host.post(f"/api/sessions/{session_id}/snapshots", json={"name": "Before refactor"})
        assert created.status_code == 201
        snapshot_id = created.json()[0]["id"]
        assert host.post(f"/api/sessions/{session_id}/snapshots/{snapshot_id}/restore").status_code == 200
        deleted = host.delete(f"/api/sessions/{session_id}/snapshots/{snapshot_id}")
        assert deleted.status_code == 200
        assert all(snapshot["id"] != snapshot_id for snapshot in deleted.json())
        assert guest_id
    finally:
        host.close()
        guest.close()


def test_role_and_identity_checks_prevent_spoofing(app) -> None:
    host = TestClient(app)
    guest = TestClient(app)
    try:
        session_id, host_id = create_room(host)
        guest_response = guest.post(
            f"/api/sessions/{session_id}/participants",
            json={"name": "Candidate User", "role": "guest"},
        )
        guest_id = guest_response.json()["id"]
        assert guest.patch(
            f"/api/sessions/{session_id}/participants/{host_id}/presence",
            json={"muted": False},
        ).status_code == 403
        assert guest.post(
            f"/api/sessions/{session_id}/messages",
            json={"authorId": host_id, "authorName": "Host User", "body": "spoof"},
        ).status_code == 403
        assert guest_id
    finally:
        host.close()
        guest.close()
