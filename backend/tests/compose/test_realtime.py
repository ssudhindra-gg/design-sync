import json
from collections.abc import Callable

import httpx
import pytest
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect

from ..conftest import create_room
from .conftest import WS_URL, Compose


def test_chat_event_reaches_every_listener(new_client: Callable[[], httpx.Client]) -> None:
    host = new_client()
    session_id, host_id = create_room(host)
    url = f"{WS_URL}/api/sessions/{session_id}/events"

    with connect(url, open_timeout=10) as first, connect(url, open_timeout=10) as second:
        sent = host.post(
            f"/api/sessions/{session_id}/messages",
            json={"authorId": host_id, "authorName": "Host User", "body": "Broadcast this"},
        )
        assert sent.status_code == 201

        expected = {"type": "chat", "sessionId": session_id, "origin": host_id}
        assert json.loads(first.recv(timeout=10)) == expected
        assert json.loads(second.recv(timeout=10)) == expected


def test_socket_for_unknown_session_is_refused(compose: Compose) -> None:
    # The server closes before accepting, which uvicorn answers with a 403.
    with pytest.raises(InvalidStatus) as refused:
        connect(f"{WS_URL}/api/sessions/no-such-session/events", open_timeout=10)
    assert refused.value.response.status_code == 403
