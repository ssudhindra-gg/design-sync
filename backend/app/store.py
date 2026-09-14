from __future__ import annotations

import asyncio
import copy
import secrets
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from fastapi import WebSocket

from .auth import AccountRecord, SessionPrincipal, hash_token, new_token
from .models import (
    ChatMessage,
    Diagram,
    DiagramEdge,
    DiagramNode,
    Notes,
    Participant,
    ParticipantStatus,
    Role,
    Session,
    SessionEvent,
    SessionState,
    Snapshot,
)


@dataclass(frozen=True)
class StoredSessionToken:
    session_id: str
    participant_id: str


def now_ms() -> int:
    return int(time.time() * 1000)


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


class InMemoryStore:
    def __init__(self, *, seed: bool = True) -> None:
        self.accounts: dict[str, AccountRecord] = {}
        self.account_tokens: dict[str, str] = {}
        self.session_tokens: dict[str, StoredSessionToken] = {}
        self.sessions: dict[str, SessionState] = {}
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = threading.RLock()
        if seed:
            self.seed()

    def add_account(self, username: str, password: str) -> AccountRecord:
        from .auth import hash_password

        account = AccountRecord(username=username, password_hash=hash_password(password))
        with self._lock:
            self.accounts[username] = account
        return account

    def seed(self) -> None:
        """Create a deterministic demo account and populated interview room."""

        self.add_account("interviewer@example.com", "demo-password")
        created = 1_700_000_000_000
        session = Session(
            id="demo-session",
            title="Distributed notifications interview",
            createdAt=created,
            retentionDays=30,
        )
        host = Participant(
            id="p_host",
            name="Alex Mendes",
            role=Role.interviewer,
            status=ParticipantStatus.admitted,
            audioConnected=False,
            muted=True,
            joinedAt=created,
        )
        candidate = Participant(
            id="p_candidate",
            name="Priya Raman",
            role=Role.guest,
            status=ParticipantStatus.admitted,
            audioConnected=False,
            muted=True,
            joinedAt=created + 60_000,
        )
        diagram = Diagram(
            nodes=[
                DiagramNode(id="n_client", kind="client", label="Web client", x=80, y=160, w=160, h=80),
                DiagramNode(id="n_api", kind="service", label="Notification API", x=360, y=160, w=190, h=80),
                DiagramNode(id="n_queue", kind="queue", label="Delivery queue", x=680, y=160, w=180, h=80),
                DiagramNode(id="n_db", kind="database", label="Notification DB", x=960, y=160, w=180, h=80),
            ],
            edges=[
                DiagramEdge(id="e_client_api", **{"from": "n_client"}, to="n_api", label="HTTPS"),
                DiagramEdge(id="e_api_queue", **{"from": "n_api"}, to="n_queue", label="publishes"),
                DiagramEdge(id="e_queue_db", **{"from": "n_queue"}, to="n_db", label="writes"),
            ],
        )
        first_message = ChatMessage(
            id="m_welcome",
            authorId=host.id,
            authorName=host.name,
            body="Let's start with the delivery guarantees and retry path.",
            at=created + 120_000,
        )
        snapshot = Snapshot(id="snap_initial", name="Initial outline", at=created + 180_000, diagram=copy.deepcopy(diagram))
        state = SessionState(
            session=session,
            participants=[host, candidate],
            diagram=diagram,
            chat=[first_message],
            notes=Notes(shared="At-least-once delivery is acceptable for the first iteration.", privateNotes="Ask about idempotency keys and backpressure."),
            snapshots=[snapshot],
        )
        with self._lock:
            self.sessions[session.id] = state

    def account_for_token(self, token: str) -> str | None:
        with self._lock:
            return self.account_tokens.get(hash_token(token))

    def issue_account_token(self, username: str) -> str:
        token = new_token()
        with self._lock:
            self.account_tokens[hash_token(token)] = username
        return token

    def issue_session_token(self, session_id: str, participant_id: str) -> str:
        token = new_token()
        with self._lock:
            self.session_tokens[hash_token(token)] = StoredSessionToken(session_id, participant_id)
        return token

    def principal_for_token(self, token: str) -> SessionPrincipal | None:
        with self._lock:
            stored = self.session_tokens.get(hash_token(token))
        if stored is None:
            return None
        return SessionPrincipal(stored.session_id, stored.participant_id)

    def get_state(self, session_id: str) -> SessionState | None:
        with self._lock:
            state = self.sessions.get(session_id)
            return copy.deepcopy(state) if state else None

    def public_state(self, session_id: str) -> SessionState | None:
        state = self.get_state(session_id)
        if state:
            state.notes.privateNotes = ""
        return state

    def find_participant(self, session_id: str, participant_id: str) -> Participant | None:
        with self._lock:
            state = self.sessions.get(session_id)
            if state is None:
                return None
            participant = next((p for p in state.participants if p.id == participant_id), None)
            return copy.deepcopy(participant) if participant else None

    def create_session(self, title: str, host_name: str) -> tuple[SessionState, Participant, str]:
        created = now_ms()
        session = Session(id=make_id("s"), title=title.strip() or "System design interview", createdAt=created)
        host = Participant(
            id=make_id("p"),
            name=host_name.strip() or "Interviewer",
            role=Role.interviewer,
            status=ParticipantStatus.admitted,
            joinedAt=created,
        )
        state = SessionState(session=session, participants=[host], diagram=Diagram(), notes=Notes())
        with self._lock:
            self.sessions[session.id] = state
        token = self.issue_session_token(session.id, host.id)
        return copy.deepcopy(state), copy.deepcopy(host), token

    def join_session(self, session_id: str, name: str, role: Role) -> tuple[Participant, str]:
        participant = Participant(
            id=make_id("p"),
            name=name.strip() or "Guest",
            role=role,
            status=ParticipantStatus.waiting if role is Role.guest else ParticipantStatus.admitted,
            joinedAt=now_ms(),
        )
        with self._lock:
            state = self.sessions.get(session_id)
            if state is None:
                raise KeyError(session_id)
            state.participants.append(participant)
        token = self.issue_session_token(session_id, participant.id)
        return copy.deepcopy(participant), token

    def update_session(self, session_id: str, patch: dict[str, Any]) -> Session:
        with self._lock:
            state = self.sessions.get(session_id)
            if state is None:
                raise KeyError(session_id)
            for key, value in patch.items():
                if value is not None:
                    setattr(state.session, key, value)
            return copy.deepcopy(state.session)

    def set_participant_status(self, session_id: str, participant_id: str, status: ParticipantStatus) -> list[Participant]:
        with self._lock:
            state = self.sessions.get(session_id)
            if state is None:
                raise KeyError(session_id)
            participant = next((p for p in state.participants if p.id == participant_id), None)
            if participant is None:
                raise KeyError(participant_id)
            participant.status = status
            return copy.deepcopy(state.participants)

    def update_presence(self, session_id: str, participant_id: str, patch: dict[str, Any]) -> list[Participant]:
        with self._lock:
            state = self.sessions.get(session_id)
            if state is None:
                raise KeyError(session_id)
            participant = next((p for p in state.participants if p.id == participant_id), None)
            if participant is None:
                raise KeyError(participant_id)
            for key, value in patch.items():
                if value is not None:
                    setattr(participant, key, value)
            return copy.deepcopy(state.participants)

    def save_diagram(self, session_id: str, diagram: Diagram) -> Diagram:
        with self._lock:
            state = self.sessions.get(session_id)
            if state is None:
                raise KeyError(session_id)
            node_ids = {node.id for node in diagram.nodes}
            if any(edge.from_ not in node_ids or edge.to not in node_ids for edge in diagram.edges):
                raise ValueError("Every edge must refer to an existing node")
            state.diagram = copy.deepcopy(diagram)
            return copy.deepcopy(state.diagram)

    def set_node_lock(self, session_id: str, node_id: str, locked: bool) -> Diagram:
        with self._lock:
            state = self.sessions.get(session_id)
            if state is None:
                raise KeyError(session_id)
            node = next((node for node in state.diagram.nodes if node.id == node_id), None)
            if node is None:
                raise KeyError(node_id)
            node.locked = locked
            return copy.deepcopy(state.diagram)

    def send_message(self, session_id: str, author_id: str, author_name: str, body: str) -> ChatMessage:
        with self._lock:
            state = self.sessions.get(session_id)
            if state is None:
                raise KeyError(session_id)
            message = ChatMessage(id=make_id("m"), authorId=author_id, authorName=author_name, body=body, at=now_ms())
            state.chat.append(message)
            return copy.deepcopy(message)

    def save_notes(self, session_id: str, patch: dict[str, Any]) -> Notes:
        with self._lock:
            state = self.sessions.get(session_id)
            if state is None:
                raise KeyError(session_id)
            for key, value in patch.items():
                if value is not None:
                    setattr(state.notes, key, value)
            return copy.deepcopy(state.notes)

    def create_snapshot(self, session_id: str, name: str) -> list[Snapshot]:
        with self._lock:
            state = self.sessions.get(session_id)
            if state is None:
                raise KeyError(session_id)
            snapshot = Snapshot(id=make_id("snap"), name=name.strip() or str(now_ms()), at=now_ms(), diagram=copy.deepcopy(state.diagram))
            state.snapshots.insert(0, snapshot)
            return copy.deepcopy(state.snapshots)

    def restore_snapshot(self, session_id: str, snapshot_id: str) -> Diagram:
        with self._lock:
            state = self.sessions.get(session_id)
            if state is None:
                raise KeyError(session_id)
            snapshot = next((snap for snap in state.snapshots if snap.id == snapshot_id), None)
            if snapshot is None:
                raise KeyError(snapshot_id)
            state.diagram = copy.deepcopy(snapshot.diagram)
            return copy.deepcopy(state.diagram)

    def delete_snapshot(self, session_id: str, snapshot_id: str) -> list[Snapshot]:
        with self._lock:
            state = self.sessions.get(session_id)
            if state is None:
                raise KeyError(session_id)
            before = len(state.snapshots)
            state.snapshots = [snap for snap in state.snapshots if snap.id != snapshot_id]
            if len(state.snapshots) == before:
                raise KeyError(snapshot_id)
            return copy.deepcopy(state.snapshots)

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        self._connections[session_id].add(websocket)

    async def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        self._connections[session_id].discard(websocket)
        if not self._connections[session_id]:
            self._connections.pop(session_id, None)

    async def publish(self, event: SessionEvent) -> None:
        sockets = list(self._connections.get(event.sessionId, set()))
        for websocket in sockets:
            try:
                await websocket.send_json(event.model_dump())
            except Exception:
                await self.disconnect(event.sessionId, websocket)


_default_store: InMemoryStore | None = None


def get_store() -> InMemoryStore:
    global _default_store
    if _default_store is None:
        _default_store = InMemoryStore(seed=True)
    return _default_store
