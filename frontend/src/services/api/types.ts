// Transport-agnostic contract for the interview backend.
// The UI only ever talks to this interface, so a real REST/WebSocket
// implementation can replace the mock without touching any component.

export const NODE_KINDS = [
  "service",
  "llm",
  "database",
  "queue",
  "cache",
  "client",
  "external",
  "rectangle",
  "note",
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export interface DiagramNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  locked?: boolean;
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export type Role = "interviewer" | "guest";
export type ParticipantStatus = "waiting" | "admitted" | "rejected";

export interface Participant {
  id: string;
  name: string;
  role: Role;
  status: ParticipantStatus;
  audioConnected: boolean;
  muted: boolean;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  at: number;
}

export interface Notes {
  shared: string;
  privateNotes: string;
}

export interface Snapshot {
  id: string;
  name: string;
  at: number;
  diagram: Diagram;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  editingPaused: boolean;
  ended: boolean;
  retentionDays: number;
}

export interface SessionState {
  session: Session;
  participants: Participant[];
  diagram: Diagram;
  chat: ChatMessage[];
  notes: Notes;
  snapshots: Snapshot[];
}

export type SessionEvent =
  | { type: "state"; sessionId: string; origin: string }
  | { type: "chat"; sessionId: string; origin: string }
  | { type: "diagram"; sessionId: string; origin: string }
  | { type: "presence"; sessionId: string; origin: string };

export interface InterviewApi {
  readonly clientId: string;

  createSession(input: { title: string; hostName: string }): Promise<{
    session: Session;
    participant: Participant;
  }>;
  getSession(sessionId: string): Promise<SessionState | null>;
  updateSession(
    sessionId: string,
    patch: Partial<Pick<Session, "title" | "editingPaused" | "ended" | "retentionDays">>,
  ): Promise<Session>;

  joinSession(input: {
    sessionId: string;
    name: string;
    role: Role;
  }): Promise<Participant>;
  setParticipantStatus(
    sessionId: string,
    participantId: string,
    status: ParticipantStatus,
  ): Promise<Participant[]>;
  updatePresence(
    sessionId: string,
    participantId: string,
    patch: Partial<Pick<Participant, "audioConnected" | "muted" | "name">>,
  ): Promise<Participant[]>;

  saveDiagram(sessionId: string, diagram: Diagram): Promise<Diagram>;
  setNodeLock(sessionId: string, nodeId: string, locked: boolean): Promise<Diagram>;

  sendMessage(input: {
    sessionId: string;
    authorId: string;
    authorName: string;
    body: string;
  }): Promise<ChatMessage>;

  saveNotes(sessionId: string, patch: Partial<Notes>): Promise<Notes>;

  createSnapshot(sessionId: string, name: string): Promise<Snapshot[]>;
  restoreSnapshot(sessionId: string, snapshotId: string): Promise<Diagram>;
  deleteSnapshot(sessionId: string, snapshotId: string): Promise<Snapshot[]>;

  subscribe(sessionId: string, handler: (event: SessionEvent) => void): () => void;
}
