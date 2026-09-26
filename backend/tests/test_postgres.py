"""Postgres support: URL normalization, the dialect-specific choices the store
makes, and real round-trips when a test database is available.

The integration tests are skipped unless `TEST_DATABASE_URL` is set, so the
default suite still runs with no database:

    make db-up
    $env:TEST_DATABASE_URL = "postgresql+psycopg://sdip:sdip@localhost:5432/sdip"
"""

from __future__ import annotations

import os
import threading

import pytest
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.pool import StaticPool

from app.store import (
    AccountRow,
    DatabaseStore,
    InMemoryStore,
    SessionRow,
    commit_or_discard_conflict,
    engine_options,
    normalize_database_url,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

requires_postgres = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="set TEST_DATABASE_URL to run the Postgres integration tests",
)


@pytest.mark.parametrize(
    "url",
    [
        "postgres://sdip:sdip@localhost:5432/sdip",
        "postgresql://sdip:sdip@localhost:5432/sdip",
    ],
)
def test_normalize_database_url_selects_the_psycopg_driver(url: str) -> None:
    assert normalize_database_url(url) == "postgresql+psycopg://sdip:sdip@localhost:5432/sdip"


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://sdip:sdip@localhost:5432/sdip",
        "postgresql+psycopg2://sdip:sdip@localhost:5432/sdip",
        "sqlite:///./whiteboard.db",
    ],
)
def test_normalize_database_url_leaves_an_explicit_driver_alone(url: str) -> None:
    assert normalize_database_url(url) == url


def test_session_state_is_stored_as_jsonb_on_postgres() -> None:
    state = SessionRow.__table__.c.state
    assert state.type.compile(postgresql.dialect()) == "JSONB"
    assert state.type.compile(sqlite.dialect()) == "JSON"


def test_engine_options_pre_ping_pooled_postgres_connections() -> None:
    options = engine_options("postgresql+psycopg://sdip:sdip@localhost:5432/sdip")
    assert options == {"connect_args": {}, "pool_pre_ping": True}


def test_engine_options_keep_the_sqlite_threading_and_pooling_behaviour() -> None:
    assert engine_options("sqlite:///./whiteboard.db")["connect_args"] == {"check_same_thread": False}
    assert engine_options("sqlite:///:memory:")["poolclass"] is StaticPool


def test_commit_or_discard_conflict_absorbs_a_row_another_writer_inserted() -> None:
    store = InMemoryStore(seed=True)

    with store._db() as db:
        db.add(AccountRow(username="interviewer@example.com", password_hash="loser"))
        assert commit_or_discard_conflict(db) is False

    assert store.accounts["interviewer@example.com"].password_hash != "loser"


@pytest.fixture
def postgres_store() -> DatabaseStore:
    return DatabaseStore(TEST_DATABASE_URL, seed=True)


@requires_postgres
def test_postgres_round_trips_a_session(postgres_store: DatabaseStore) -> None:
    state, host, token = postgres_store.create_session("Postgres interview", "Host User")
    session_id = state.session.id

    postgres_store.send_message(session_id, host.id, host.name, "Stored in Postgres")
    postgres_store.save_notes(session_id, {"shared": "Shared note"})
    reopened = DatabaseStore(TEST_DATABASE_URL, seed=False)
    stored = reopened.get_state(session_id)

    assert stored is not None
    assert stored.session.title == "Postgres interview"
    assert [m.body for m in stored.chat] == ["Stored in Postgres"]
    assert stored.notes.shared == "Shared note"
    assert reopened.principal_for_token(token).session_id == session_id


@requires_postgres
def test_seeding_the_same_database_twice_is_idempotent() -> None:
    DatabaseStore(TEST_DATABASE_URL, seed=True)
    second = DatabaseStore(TEST_DATABASE_URL, seed=True)

    assert "interviewer@example.com" in second.accounts
    assert second.get_state("demo-session") is not None


@requires_postgres
def test_concurrent_writers_from_separate_stores_keep_every_message() -> None:
    """Two stores stand in for two workers: they share no in-process lock, so
    only a database-level row lock keeps one read-modify-write from clobbering
    the other."""
    writer_a = DatabaseStore(TEST_DATABASE_URL, seed=True)
    writer_b = DatabaseStore(TEST_DATABASE_URL, seed=False)
    state, host, _ = writer_a.create_session("Concurrent writes", "Host User")
    session_id = state.session.id

    def post(store: DatabaseStore, tag: str) -> None:
        for index in range(10):
            store.send_message(session_id, host.id, host.name, f"{tag}-{index}")

    threads = [
        threading.Thread(target=post, args=(writer_a, "a")),
        threading.Thread(target=post, args=(writer_b, "b")),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    bodies = {message.body for message in writer_a.get_state(session_id).chat}
    assert bodies == {f"{tag}-{index}" for tag in ("a", "b") for index in range(10)}
