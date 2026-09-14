from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class Role(str, Enum):
    interviewer = "interviewer"
    guest = "guest"


class ParticipantStatus(str, Enum):
    waiting = "waiting"
    admitted = "admitted"
    rejected = "rejected"


class NodeKind(str, Enum):
    service = "service"
    llm = "llm"
    database = "database"
    queue = "queue"
    cache = "cache"
    client = "client"
    external = "external"
    rectangle = "rectangle"
    note = "note"


class DiagramNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: NodeKind
    label: str
    x: float
    y: float
    w: float
    h: float
    locked: bool = False


class DiagramEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    from_: str = Field(alias="from")
    to: str
    label: str

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Diagram(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nodes: list[DiagramNode] = Field(default_factory=list)
    edges: list[DiagramEdge] = Field(default_factory=list)


class Participant(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    role: Role
    status: ParticipantStatus
    audioConnected: bool = False
    muted: bool = True
    joinedAt: int


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    authorId: str
    authorName: str
    body: str
    at: int


class Notes(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shared: str = ""
    privateNotes: str = ""


class Snapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    at: int
    diagram: Diagram


class Session(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    createdAt: int
    editingPaused: bool = False
    ended: bool = False
    retentionDays: int = Field(default=30, ge=1)


class SessionState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session: Session
    participants: list[Participant] = Field(default_factory=list)
    diagram: Diagram
    chat: list[ChatMessage] = Field(default_factory=list)
    notes: Notes
    snapshots: list[Snapshot] = Field(default_factory=list)


class SessionEvent(BaseModel):
    type: str
    sessionId: str
    origin: str


class CreateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    hostName: str


class CreateSessionResponse(BaseModel):
    session: Session
    participant: Participant


class UpdateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    editingPaused: bool | None = None
    ended: bool | None = None
    retentionDays: int | None = Field(default=None, ge=1)


class JoinSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    role: Role


class SetParticipantStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ParticipantStatus


class UpdatePresenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audioConnected: bool | None = None
    muted: bool | None = None
    name: str | None = None


class SetNodeLockRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    locked: bool


class SendMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    authorId: str
    authorName: str
    body: str


class SaveNotesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shared: str | None = None
    privateNotes: str | None = None


class CreateSnapshotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
