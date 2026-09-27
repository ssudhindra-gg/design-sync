import time
import uuid
from collections.abc import Callable

import httpx

from ..conftest import login
from .conftest import Compose


def test_both_services_report_healthy(compose: Compose) -> None:
    # The app's healthcheck only runs every 30s, so allow for one full interval.
    deadline = time.monotonic() + 90
    health = compose.health()
    while health != {"db": "healthy", "app": "healthy"} and time.monotonic() < deadline:
        time.sleep(2)
        health = compose.health()
    assert health == {"db": "healthy", "app": "healthy"}


def test_app_writes_sessions_to_postgres(compose: Compose, new_client: Callable[[], httpx.Client]) -> None:
    # The image defaults DATABASE_URL to SQLite. If compose stopped overriding
    # it, every API test would still pass, so look for the row in Postgres.
    client = new_client()
    title = f"compose-{uuid.uuid4().hex}"
    created = client.post(
        "/api/sessions",
        headers={"Authorization": f"Bearer {login(client)}"},
        json={"title": title, "hostName": "Host User"},
    )
    assert created.status_code == 201
    session_id = created.json()["session"]["id"]

    stored = compose.psql(f"select state->'session'->>'title' from sessions where id = '{session_id}'")
    assert stored == title
