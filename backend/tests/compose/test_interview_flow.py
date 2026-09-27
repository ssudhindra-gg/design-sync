from collections.abc import Callable

import httpx

from ..conftest import create_room
from .conftest import admit_guest

DIAGRAM = {
    "nodes": [
        {"id": "api", "kind": "service", "label": "API", "x": 1, "y": 2, "w": 100, "h": 80},
        {"id": "db", "kind": "database", "label": "DB", "x": 200, "y": 2, "w": 100, "h": 80},
    ],
    "edges": [{"id": "edge", "from": "api", "to": "db", "label": "SQL"}],
}


def test_full_interview_over_real_http(new_client: Callable[[], httpx.Client]) -> None:
    """One journey through the deployed stack; the rules are covered in-process."""
    host, guest = new_client(), new_client()
    session_id, host_id = create_room(host)
    guest_id = admit_guest(host, guest, session_id)

    assert guest.post(
        f"/api/sessions/{session_id}/messages",
        json={"authorId": guest_id, "authorName": "Candidate User", "body": "Shall I start with the API?"},
    ).status_code == 201
    assert guest.put(f"/api/sessions/{session_id}/diagram", json=DIAGRAM).status_code == 200
    assert host.patch(f"/api/sessions/{session_id}/diagram/nodes/db/lock", json={"locked": True}).status_code == 200
    assert host.patch(
        f"/api/sessions/{session_id}/notes",
        json={"shared": "Agree on retries.", "privateNotes": "Probe failure isolation."},
    ).status_code == 200

    snapshots = host.post(f"/api/sessions/{session_id}/snapshots", json={"name": "Two boxes"})
    assert snapshots.status_code == 201
    snapshot_id = snapshots.json()[0]["id"]
    # Change the diagram after the snapshot, then restore it.
    grown = {**DIAGRAM, "nodes": [*DIAGRAM["nodes"], {"id": "cache", "kind": "cache", "label": "Cache", "x": 400, "y": 2, "w": 100, "h": 80}]}
    grown["nodes"][1] = {**grown["nodes"][1], "locked": True}
    assert guest.put(f"/api/sessions/{session_id}/diagram", json=grown).status_code == 200
    assert host.post(f"/api/sessions/{session_id}/snapshots/{snapshot_id}/restore").status_code == 200

    state = host.get(f"/api/sessions/{session_id}").json()
    participants = {p["id"]: p for p in state["participants"]}
    assert participants[host_id]["role"] == "interviewer"
    assert participants[guest_id]["status"] == "admitted"
    assert [m["body"] for m in state["chat"]] == ["Shall I start with the API?"]
    assert [n["id"] for n in state["diagram"]["nodes"]] == ["api", "db"]
    assert next(n for n in state["diagram"]["nodes"] if n["id"] == "db")["locked"] is True
    assert state["notes"]["shared"] == "Agree on retries."
    assert state["notes"]["privateNotes"] == "Probe failure isolation."
    assert [s["name"] for s in state["snapshots"]] == ["Two boxes"]

    # Private notes stay private when read through the guest's cookie.
    assert guest.get(f"/api/sessions/{session_id}").json()["notes"]["privateNotes"] == ""
