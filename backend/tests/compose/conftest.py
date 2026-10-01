"""Fixtures for the tests that run against ../../../docker-compose.yaml.

These build the real image and start it next to a real Postgres, so they are
slow and need Docker. They are skipped unless COMPOSE_TESTS=1 (`make
test-compose` sets it), the same way test_postgres.py waits for
TEST_DATABASE_URL.

The stack runs under its own compose project name and host port, so it never
touches a `docker compose up` you already have running or that stack's data.
It is torn down with its volume at the end of the run.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from collections.abc import Callable, Iterator
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[3]
COMPOSE_FILE = ROOT / "docker-compose.yaml"
PROJECT = "design-sync-it"
APP_PORT = int(os.getenv("COMPOSE_TEST_APP_PORT", "18000"))
BASE_URL = f"http://localhost:{APP_PORT}"
WS_URL = f"ws://localhost:{APP_PORT}"
ENABLED = os.getenv("COMPOSE_TESTS") == "1"


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if ENABLED:
        return
    skip = pytest.mark.skip(reason="set COMPOSE_TESTS=1 (or run `make test-compose`) to run against docker compose")
    here = Path(__file__).parent
    for item in items:
        if here in item.path.parents:
            item.add_marker(skip)


class Compose:
    """Drives the test project's containers through the docker compose CLI."""

    def run(self, *args: str, timeout: float = 900) -> str:
        # APP_PORT goes on every call, not just `up`: a later `up` without it
        # would recreate the app on the default port.
        result = subprocess.run(
            ["docker", "compose", "-f", str(COMPOSE_FILE), "-p", PROJECT, *args],
            env={**os.environ, "APP_PORT": str(APP_PORT), "APP_VERSION": "compose-test"},
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            raise AssertionError(f"docker compose {' '.join(args)} failed:\n{result.stdout}\n{result.stderr}")
        return result.stdout

    def psql(self, sql: str) -> str:
        return self.run("exec", "-T", "db", "psql", "-U", "sdip", "-d", "sdip", "-tAc", sql).strip()

    def health(self) -> dict[str, str]:
        """Service name -> health ("healthy", "starting", or "" without a check)."""
        output = self.run("ps", "--format", "json").strip()
        # Compose v2 prints one JSON object per line; older releases a JSON array.
        rows = json.loads(output) if output.startswith("[") else [json.loads(line) for line in output.splitlines()]
        return {row["Service"]: row.get("Health", "") for row in rows}

    def wait_until_serving(self, timeout: float = 120) -> None:
        """Block until the app answers HTTP, which implies its schema exists."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                if httpx.get(f"{BASE_URL}/api/health", timeout=2).status_code == 200:
                    return
            except httpx.TransportError:
                pass
            time.sleep(0.5)
        raise AssertionError(f"app did not answer on {BASE_URL} within {timeout}s:\n{self.run('logs', '--tail', '50')}")

    def restart_app(self) -> None:
        self.run("restart", "app")
        self.wait_until_serving()

    def down_and_up(self) -> None:
        """Recreate every container while keeping the Postgres volume."""
        self.run("down")
        self.run("up", "-d")
        self.wait_until_serving()


@pytest.fixture(scope="session")
def compose() -> Iterator[Compose]:
    stack = Compose()
    # Clear anything a previous, interrupted run left behind.
    stack.run("down", "-v", "--remove-orphans")
    try:
        stack.run("up", "-d", "--build")
        stack.wait_until_serving()
        yield stack
    finally:
        stack.run("down", "-v", "--remove-orphans")


@pytest.fixture
def new_client(compose: Compose) -> Iterator[Callable[[], httpx.Client]]:
    """Factory for HTTP clients; each keeps its own cookies, like a browser."""
    clients: list[httpx.Client] = []

    def make() -> httpx.Client:
        client = httpx.Client(base_url=BASE_URL, timeout=10)
        clients.append(client)
        return client

    yield make
    for client in clients:
        client.close()


def admit_guest(host: httpx.Client, guest: httpx.Client, session_id: str, name: str = "Candidate User") -> str:
    joined = guest.post(f"/api/sessions/{session_id}/participants", json={"name": name, "role": "guest"})
    assert joined.status_code == 201
    participant_id = joined.json()["id"]
    admitted = host.patch(
        f"/api/sessions/{session_id}/participants/{participant_id}/status",
        json={"status": "admitted"},
    )
    assert admitted.status_code == 200
    return participant_id
