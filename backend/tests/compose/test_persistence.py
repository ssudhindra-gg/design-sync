from collections.abc import Callable

import httpx

from ..conftest import create_room, login
from .conftest import Compose


def post_message(client: httpx.Client, session_id: str, author_id: str, body: str) -> None:
    response = client.post(
        f"/api/sessions/{session_id}/messages",
        json={"authorId": author_id, "authorName": "Host User", "body": body},
    )
    assert response.status_code == 201


def assert_survives(restart: Callable[[], None], new_client: Callable[[], httpx.Client]) -> None:
    host = new_client()
    session_id, host_id = create_room(host)
    post_message(host, session_id, host_id, "before")

    restart()

    # The host's cookie is still honoured, so tokens were persisted too.
    post_message(host, session_id, host_id, "after")
    chat = host.get(f"/api/sessions/{session_id}").json()["chat"]
    assert [m["body"] for m in chat] == ["before", "after"]
    assert login(new_client())


def test_data_survives_an_app_restart(compose: Compose, new_client: Callable[[], httpx.Client]) -> None:
    assert_survives(compose.restart_app, new_client)


def test_data_survives_down_and_up(compose: Compose, new_client: Callable[[], httpx.Client]) -> None:
    assert_survives(compose.down_and_up, new_client)


def test_startup_seed_leaves_an_existing_demo_session_alone(
    compose: Compose, new_client: Callable[[], httpx.Client]
) -> None:
    compose.psql(
        "update sessions set state = jsonb_set(state, '{session,title}', '\"Edited by a user\"') "
        "where id = 'demo-session'"
    )

    compose.restart_app()

    assert compose.psql("select count(*) from sessions where id = 'demo-session'") == "1"
    demo = new_client().get("/api/sessions/demo-session").json()
    assert demo["session"]["title"] == "Edited by a user"
