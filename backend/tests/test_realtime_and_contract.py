from fastapi.testclient import TestClient

from .conftest import create_room


def test_websocket_broadcasts_session_events(app, store) -> None:
    token = store.issue_session_token("demo-session", "p_host")
    listener = TestClient(app)
    trigger = TestClient(app)
    try:
        with listener.websocket_connect("/api/sessions/demo-session/events") as websocket:
            response = trigger.post(
                "/api/sessions/demo-session/messages",
                headers={"Authorization": f"Bearer {token}"},
                json={"authorId": "p_host", "authorName": "Alex Mendes", "body": "Broadcast this"},
            )
            assert response.status_code == 201
            event = websocket.receive_json()
            assert event == {"type": "chat", "sessionId": "demo-session", "origin": "p_host"}
    finally:
        listener.close()
        trigger.close()


def test_openapi_has_frontend_operations(client: TestClient) -> None:
    document = client.get("/openapi.json").json()
    assert "/api/sessions" in document["paths"]
    operations = {
        operation["operationId"]
        for path in document["paths"].values()
        for operation in path.values()
        if isinstance(operation, dict) and "operationId" in operation
    }
    assert {
        "createSession",
        "getSession",
        "updateSession",
        "joinSession",
        "setParticipantStatus",
        "updatePresence",
        "saveDiagram",
        "setNodeLock",
        "sendMessage",
        "saveNotes",
        "createSnapshot",
        "restoreSnapshot",
        "deleteSnapshot",
    } <= operations
