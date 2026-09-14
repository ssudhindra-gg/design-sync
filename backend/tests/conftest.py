from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import create_app
from app.store import InMemoryStore


@pytest.fixture
def store() -> InMemoryStore:
    return InMemoryStore(seed=True)


@pytest.fixture
def app(store: InMemoryStore) -> FastAPI:
    return create_app(store)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def login(client: TestClient) -> str:
    response = client.post(
        "/api/auth/login",
        json={"username": "interviewer@example.com", "password": "demo-password"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def create_room(client: TestClient) -> tuple[str, str]:
    account_token = login(client)
    response = client.post(
        "/api/sessions",
        headers={"Authorization": f"Bearer {account_token}"},
        json={"title": "Test interview", "hostName": "Host User"},
    )
    assert response.status_code == 201
    return response.json()["session"]["id"], response.json()["participant"]["id"]
