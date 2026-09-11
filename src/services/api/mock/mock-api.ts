import type {
  ChatMessage,
  Diagram,
  InterviewApi,
  Notes,
  Participant,
  ParticipantStatus,
  Session,
  SessionEvent,
  SessionState,
  Snapshot,
} from "../types";
import { latency, onEvent, publish, readDb, uid, writeDb } from "./store";

function emptyState(session: Session, host: Participant): SessionState {
  return {
    session,
    participants: [host],
    diagram: { nodes: [], edges: [] },
    chat: [],
    notes: { shared: "", privateNotes: "" },
    snapshots: [],
  };
}

export function createMockApi(): InterviewApi {
  const clientId = uid("client");

  function load(sessionId: string): SessionState | null {
    return readDb()[sessionId] ?? null;
  }

  function commit(
    sessionId: string,
    mutate: (state: SessionState) => void,
    kind: SessionEvent["type"] = "state",
  ): SessionState {
    const db = readDb();
    const state = db[sessionId];
    if (!state) throw new Error("Session not found");
    mutate(state);
    db[sessionId] = state;
    writeDb(db);
    publish({ type: kind, sessionId, origin: clientId } as SessionEvent);
    return state;
  }

  return {
    clientId,

    async createSession({ title, hostName }) {
      await latency();
      const session: Session = {
        id: uid("s").replace("s_", ""),
        title: title.trim() || "System design interview",
        createdAt: Date.now(),
        editingPaused: false,
        ended: false,
        retentionDays: 30,
      };
      const host: Participant = {
        id: uid("p"),
        name: hostName.trim() || "Interviewer",
        role: "interviewer",
        status: "admitted",
        audioConnected: false,
        muted: true,
        joinedAt: Date.now(),
      };
      const db = readDb();
      db[session.id] = emptyState(session, host);
      writeDb(db);
      publish({ type: "state", sessionId: session.id, origin: clientId });
      return { session, participant: host };
    },

    async getSession(sessionId) {
      await latency(40, 120);
      return load(sessionId);
    },

    async updateSession(sessionId, patch) {
      await latency();
      const state = commit(sessionId, (s) => {
        Object.assign(s.session, patch);
      });
      return state.session;
    },

    async joinSession({ sessionId, name, role }) {
      await latency();
      const participant: Participant = {
        id: uid("p"),
        name: name.trim() || "Guest",
        role,
        status: role === "interviewer" ? "admitted" : "waiting",
        audioConnected: false,
        muted: true,
        joinedAt: Date.now(),
      };
      commit(
        sessionId,
        (s) => {
          s.participants.push(participant);
        },
        "presence",
      );
      return participant;
    },

    async setParticipantStatus(sessionId, participantId, status: ParticipantStatus) {
      await latency();
      const state = commit(
        sessionId,
        (s) => {
          const p = s.participants.find((x) => x.id === participantId);
          if (p) p.status = status;
        },
        "presence",
      );
      return state.participants;
    },

    async updatePresence(sessionId, participantId, patch) {
      await latency(30, 90);
      const state = commit(
        sessionId,
        (s) => {
          const p = s.participants.find((x) => x.id === participantId);
          if (p) Object.assign(p, patch);
        },
        "presence",
      );
      return state.participants;
    },

    async saveDiagram(sessionId, diagram: Diagram) {
      await latency(30, 100);
      const state = commit(
        sessionId,
        (s) => {
          s.diagram = diagram;
        },
        "diagram",
      );
      return state.diagram;
    },

    async setNodeLock(sessionId, nodeId, locked) {
      await latency(30, 100);
      const state = commit(
        sessionId,
        (s) => {
          const n = s.diagram.nodes.find((x) => x.id === nodeId);
          if (n) n.locked = locked;
        },
        "diagram",
      );
      return state.diagram;
    },

    async sendMessage({ sessionId, authorId, authorName, body }) {
      await latency(60, 160);
      const message: ChatMessage = {
        id: uid("m"),
        authorId,
        authorName,
        body,
        at: Date.now(),
      };
      commit(
        sessionId,
        (s) => {
          s.chat.push(message);
        },
        "chat",
      );

      // Simulated reply from another admitted participant, so the drawer
      // behaves like a real two-way room while the backend is mocked.
      const state = load(sessionId);
      const other = state?.participants.find(
        (p) => p.status === "admitted" && p.id !== authorId,
      );
      if (other && Math.random() < 0.5) {
        const replies = [
          "Got it — can you walk me through the write path?",
          "Makes sense. What happens if that queue backs up?",
          "Noted. Let's come back to scaling in a minute.",
          "Sounds good.",
        ];
        setTimeout(() => {
          try {
            commit(
              sessionId,
              (s) => {
                s.chat.push({
                  id: uid("m"),
                  authorId: other.id,
                  authorName: other.name,
                  body: replies[Math.floor(Math.random() * replies.length)],
                  at: Date.now(),
                });
              },
              "chat",
            );
          } catch {
            /* session ended */
          }
        }, 1400);
      }

      return message;
    },

    async saveNotes(sessionId, patch: Partial<Notes>) {
      await latency(40, 120);
      const state = commit(sessionId, (s) => {
        s.notes = { ...s.notes, ...patch };
      });
      return state.notes;
    },

    async createSnapshot(sessionId, name) {
      await latency();
      const state = commit(sessionId, (s) => {
        const snap: Snapshot = {
          id: uid("snap"),
          name: name.trim() || new Date().toLocaleString(),
          at: Date.now(),
          diagram: JSON.parse(JSON.stringify(s.diagram)) as Diagram,
        };
        s.snapshots.unshift(snap);
      });
      return state.snapshots;
    },

    async restoreSnapshot(sessionId, snapshotId) {
      await latency();
      const state = commit(
        sessionId,
        (s) => {
          const snap = s.snapshots.find((x) => x.id === snapshotId);
          if (snap) s.diagram = JSON.parse(JSON.stringify(snap.diagram)) as Diagram;
        },
        "diagram",
      );
      return state.diagram;
    },

    async deleteSnapshot(sessionId, snapshotId) {
      await latency(40, 120);
      const state = commit(sessionId, (s) => {
        s.snapshots = s.snapshots.filter((x) => x.id !== snapshotId);
      });
      return state.snapshots;
    },

    subscribe(sessionId, handler) {
      return onEvent((event) => {
        if (event.sessionId === sessionId) handler(event);
      });
    },
  };
}
