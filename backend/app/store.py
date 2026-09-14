from __future__ import annotations

import copy
import os
import threading
from collections import defaultdict
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from fastapi import WebSocket
from sqlalchemy import JSON, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session as DatabaseSession, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

from .auth import AccountRecord, SessionPrincipal, hash_token, new_token
from .models import ChatMessage, Diagram, DiagramEdge, DiagramNode, Notes, Participant, ParticipantStatus, Role, Session, SessionEvent, SessionState, Snapshot

class Base(DeclarativeBase): pass
class AccountRow(Base):
    __tablename__ = "accounts"
    username: Mapped[str] = mapped_column(String(255), primary_key=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
class TokenRow(Base):
    __tablename__ = "tokens"
    token_hash: Mapped[str] = mapped_column(String(255), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    participant_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
class SessionRow(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    state: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

@dataclass(frozen=True)
class StoredSessionToken:
    session_id: str
    participant_id: str

def now_ms() -> int:
    import time
    return int(time.time() * 1000)
def make_id(prefix: str) -> str: return f"{prefix}_{uuid4().hex[:10]}"

class DatabaseStore:
    """SQLAlchemy persistence boundary; DATABASE_URL selects the backend."""
    def __init__(self, database_url: str | None = None, *, seed: bool = True) -> None:
        self.database_url = database_url or os.getenv("DATABASE_URL", "sqlite:///./whiteboard.db")
        args = {"check_same_thread": False} if self.database_url.startswith("sqlite") else {}
        pool = StaticPool if self.database_url == "sqlite:///:memory:" else None
        engine_options = {"connect_args": args}
        if pool is not None: engine_options["poolclass"] = pool
        self.engine = create_engine(self.database_url, **engine_options)
        Base.metadata.create_all(self.engine)
        self._session_factory = sessionmaker(bind=self.engine, expire_on_commit=False)
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = threading.RLock()
        if seed: self.seed()
    @property
    def accounts(self) -> dict[str, AccountRecord]:
        with self._db() as db:
            return {r.username: AccountRecord(username=r.username, password_hash=r.password_hash) for r in db.scalars(select(AccountRow)).all()}
    def _db(self) -> DatabaseSession: return self._session_factory()
    @staticmethod
    def _state(row: SessionRow | None) -> SessionState | None: return SessionState.model_validate(row.state) if row else None
    @staticmethod
    def _dump(state: SessionState) -> dict[str, Any]: return state.model_dump(mode="json", by_alias=True)
    def add_account(self, username: str, password: str) -> AccountRecord:
        from .auth import hash_password
        account = AccountRecord(username=username, password_hash=hash_password(password))
        with self._db() as db:
            row = db.get(AccountRow, username)
            if row is None: db.add(AccountRow(username=username, password_hash=account.password_hash)); db.commit()
            else: account = AccountRecord(username=row.username, password_hash=row.password_hash)
        return account
    def seed(self) -> None:
        self.add_account("interviewer@example.com", "demo-password")
        with self._db() as db:
            if db.get(SessionRow, "demo-session") is not None: return
        created = 1_700_000_000_000
        session = Session(id="demo-session", title="Distributed notifications interview", createdAt=created, retentionDays=30)
        host = Participant(id="p_host", name="Alex Mendes", role=Role.interviewer, status=ParticipantStatus.admitted, audioConnected=False, muted=True, joinedAt=created)
        candidate = Participant(id="p_candidate", name="Priya Raman", role=Role.guest, status=ParticipantStatus.admitted, audioConnected=False, muted=True, joinedAt=created + 60_000)
        diagram = Diagram(nodes=[DiagramNode(id="n_client", kind="client", label="Web client", x=80, y=160, w=160, h=80), DiagramNode(id="n_api", kind="service", label="Notification API", x=360, y=160, w=190, h=80), DiagramNode(id="n_queue", kind="queue", label="Delivery queue", x=680, y=160, w=180, h=80), DiagramNode(id="n_db", kind="database", label="Notification DB", x=960, y=160, w=180, h=80)], edges=[DiagramEdge(id="e_client_api", **{"from": "n_client"}, to="n_api", label="HTTPS"), DiagramEdge(id="e_api_queue", **{"from": "n_api"}, to="n_queue", label="publishes"), DiagramEdge(id="e_queue_db", **{"from": "n_queue"}, to="n_db", label="writes")])
        state = SessionState(session=session, participants=[host, candidate], diagram=diagram, chat=[ChatMessage(id="m_welcome", authorId=host.id, authorName=host.name, body="Let's start with the delivery guarantees and retry path.", at=created + 120_000)], notes=Notes(shared="At-least-once delivery is acceptable for the first iteration.", privateNotes="Ask about idempotency keys and backpressure."), snapshots=[Snapshot(id="snap_initial", name="Initial outline", at=created + 180_000, diagram=copy.deepcopy(diagram))])
        with self._db() as db: db.add(SessionRow(id=state.session.id, state=self._dump(state))); db.commit()
    def account_for_token(self, token: str) -> str | None:
        with self._db() as db:
            row = db.get(TokenRow, hash_token(token)); return row.username if row and row.kind == "account" else None
    def issue_account_token(self, username: str) -> str:
        token = new_token()
        with self._db() as db: db.add(TokenRow(token_hash=hash_token(token), kind="account", username=username)); db.commit()
        return token
    def issue_session_token(self, session_id: str, participant_id: str) -> str:
        token = new_token()
        with self._db() as db: db.add(TokenRow(token_hash=hash_token(token), kind="session", session_id=session_id, participant_id=participant_id)); db.commit()
        return token
    def principal_for_token(self, token: str) -> SessionPrincipal | None:
        with self._db() as db:
            row = db.get(TokenRow, hash_token(token)); return SessionPrincipal(row.session_id, row.participant_id) if row and row.kind == "session" else None
    def get_state(self, session_id: str) -> SessionState | None:
        with self._db() as db: return copy.deepcopy(self._state(db.get(SessionRow, session_id)))
    def public_state(self, session_id: str) -> SessionState | None:
        state = self.get_state(session_id)
        if state: state.notes.privateNotes = ""
        return state
    def _update(self, session_id: str, mutate) -> SessionState:
        with self._lock, self._db() as db:
            row = db.get(SessionRow, session_id); state = self._state(row)
            if state is None: raise KeyError(session_id)
            mutate(state); row.state = self._dump(state); db.commit(); return copy.deepcopy(state)
    def find_participant(self, session_id: str, participant_id: str) -> Participant | None:
        state = self.get_state(session_id); participant = next((p for p in state.participants if p.id == participant_id), None) if state else None
        return copy.deepcopy(participant) if participant else None
    def create_session(self, title: str, host_name: str):
        created = now_ms(); session = Session(id=make_id("s"), title=title.strip() or "System design interview", createdAt=created)
        host = Participant(id=make_id("p"), name=host_name.strip() or "Interviewer", role=Role.interviewer, status=ParticipantStatus.admitted, joinedAt=created); state = SessionState(session=session, participants=[host], diagram=Diagram(), notes=Notes())
        with self._db() as db: db.add(SessionRow(id=session.id, state=self._dump(state))); db.commit()
        return copy.deepcopy(state), copy.deepcopy(host), self.issue_session_token(session.id, host.id)
    def join_session(self, session_id: str, name: str, role: Role):
        participant = Participant(id=make_id("p"), name=name.strip() or "Guest", role=role, status=ParticipantStatus.waiting if role is Role.guest else ParticipantStatus.admitted, joinedAt=now_ms()); self._update(session_id, lambda s: s.participants.append(participant)); return copy.deepcopy(participant), self.issue_session_token(session_id, participant.id)
    def update_session(self, session_id: str, patch: dict[str, Any]) -> Session: return self._update(session_id, lambda s: [setattr(s.session, k, v) for k, v in patch.items() if v is not None]).session
    def set_participant_status(self, session_id: str, participant_id: str, status: ParticipantStatus):
        def m(s):
            p = next((p for p in s.participants if p.id == participant_id), None)
            if p is None: raise KeyError(participant_id)
            p.status = status
        return self._update(session_id, m).participants
    def update_presence(self, session_id: str, participant_id: str, patch: dict[str, Any]):
        def m(s):
            p = next((p for p in s.participants if p.id == participant_id), None)
            if p is None: raise KeyError(participant_id)
            for k, v in patch.items():
                if v is not None: setattr(p, k, v)
        return self._update(session_id, m).participants
    def save_diagram(self, session_id: str, diagram: Diagram):
        def m(s):
            ids = {n.id for n in diagram.nodes}
            if any(e.from_ not in ids or e.to not in ids for e in diagram.edges): raise ValueError("Every edge must refer to an existing node")
            s.diagram = copy.deepcopy(diagram)
        return self._update(session_id, m).diagram
    def set_node_lock(self, session_id: str, node_id: str, locked: bool):
        def m(s):
            n = next((n for n in s.diagram.nodes if n.id == node_id), None)
            if n is None: raise KeyError(node_id)
            n.locked = locked
        return self._update(session_id, m).diagram
    def send_message(self, session_id: str, author_id: str, author_name: str, body: str):
        msg = ChatMessage(id=make_id("m"), authorId=author_id, authorName=author_name, body=body, at=now_ms()); self._update(session_id, lambda s: s.chat.append(msg)); return msg
    def save_notes(self, session_id: str, patch: dict[str, Any]): return self._update(session_id, lambda s: [setattr(s.notes, k, v) for k, v in patch.items() if v is not None]).notes
    def create_snapshot(self, session_id: str, name: str):
        def m(s): s.snapshots.insert(0, Snapshot(id=make_id("snap"), name=name.strip() or str(now_ms()), at=now_ms(), diagram=copy.deepcopy(s.diagram)))
        return self._update(session_id, m).snapshots
    def restore_snapshot(self, session_id: str, snapshot_id: str):
        def m(s):
            snap = next((x for x in s.snapshots if x.id == snapshot_id), None)
            if snap is None: raise KeyError(snapshot_id)
            s.diagram = copy.deepcopy(snap.diagram)
        return self._update(session_id, m).diagram
    def delete_snapshot(self, session_id: str, snapshot_id: str):
        def m(s):
            before = len(s.snapshots); s.snapshots = [x for x in s.snapshots if x.id != snapshot_id]
            if len(s.snapshots) == before: raise KeyError(snapshot_id)
        return self._update(session_id, m).snapshots
    async def connect(self, session_id: str, websocket: WebSocket) -> None: self._connections[session_id].add(websocket)
    async def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        self._connections[session_id].discard(websocket)
        if not self._connections[session_id]: self._connections.pop(session_id, None)
    async def publish(self, event: SessionEvent) -> None:
        for ws in list(self._connections.get(event.sessionId, set())):
            try: await ws.send_json(event.model_dump())
            except Exception: await self.disconnect(event.sessionId, ws)

class InMemoryStore(DatabaseStore):
    """Compatibility name for tests; it uses an isolated SQLite database."""
    def __init__(self, *, seed: bool = True): super().__init__("sqlite:///:memory:", seed=seed)

_default_store: DatabaseStore | None = None
def get_store() -> DatabaseStore:
    global _default_store
    if _default_store is None: _default_store = DatabaseStore(seed=True)
    return _default_store
