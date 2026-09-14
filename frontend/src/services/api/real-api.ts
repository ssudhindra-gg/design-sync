import type {
  ChatMessage,
  Diagram,
  InterviewApi,
  Notes,
  Participant,
  Session,
  SessionEvent,
  SessionState,
  Snapshot,
} from "./types";

const defaultApiUrl =
  typeof window !== "undefined"
    ? `http://${window.location.hostname}:8000/api`
    : "http://localhost:8000/api";
const apiRoot = (import.meta.env.VITE_API_URL ?? defaultApiUrl).replace(/\/$/, "");
const accountUsername = import.meta.env.VITE_API_USERNAME ?? "interviewer@example.com";
const accountPassword = import.meta.env.VITE_API_PASSWORD ?? "demo-password";

type ApiError = { code?: string; message?: string };

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function makeClientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `client_${Math.random().toString(36).slice(2)}`;
}

export function createRealApi(): InterviewApi {
  const clientId = makeClientId();
  let accountToken: string | null = null;
  let loginPromise: Promise<string> | null = null;

  async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(`${apiRoot}${path}`, { ...init, headers, credentials: "include" });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as ApiError | null;
      throw new HttpError(response.status, error?.message ?? `Request failed (${response.status})`);
    }
    return (await response.json()) as T;
  }

  async function getAccountToken() {
    if (accountToken) return accountToken;
    loginPromise ??= request<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: accountUsername, password: accountPassword }),
    }).then(({ access_token }) => {
      accountToken = access_token;
      return access_token;
    }).finally(() => {
      loginPromise = null;
    });
    return loginPromise;
  }

  return {
    clientId,

    async createSession(input) {
      return request<{ session: Session; participant: Participant }>(
        "/sessions",
        { method: "POST", body: JSON.stringify(input) },
        await getAccountToken(),
      );
    },

    getSession(sessionId) {
      return request<SessionState | null>(`/sessions/${encodeURIComponent(sessionId)}`).catch((error: unknown) => {
        if (error instanceof HttpError && error.status === 404) return null;
        throw error;
      });
    },

    updateSession(sessionId, patch) {
      return request<Session>(`/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },

    joinSession({ sessionId, name, role }) {
      return request<Participant>(`/sessions/${encodeURIComponent(sessionId)}/participants`, {
        method: "POST",
        body: JSON.stringify({ name, role }),
      });
    },

    setParticipantStatus(sessionId, participantId, status) {
      return request<Participant[]>(`/sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(participantId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    },

    updatePresence(sessionId, participantId, patch) {
      return request<Participant[]>(`/sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(participantId)}/presence`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },

    saveDiagram(sessionId, diagram) {
      return request<Diagram>(`/sessions/${encodeURIComponent(sessionId)}/diagram`, {
        method: "PUT",
        body: JSON.stringify(diagram),
      });
    },

    setNodeLock(sessionId, nodeId, locked) {
      return request<Diagram>(`/sessions/${encodeURIComponent(sessionId)}/diagram/nodes/${encodeURIComponent(nodeId)}/lock`, {
        method: "PATCH",
        body: JSON.stringify({ locked }),
      });
    },

    sendMessage({ sessionId, authorId, authorName, body }) {
      return request<ChatMessage>(`/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ authorId, authorName, body }),
      });
    },

    saveNotes(sessionId, patch) {
      return request<Notes>(`/sessions/${encodeURIComponent(sessionId)}/notes`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },

    createSnapshot(sessionId, name) {
      return request<Snapshot[]>(`/sessions/${encodeURIComponent(sessionId)}/snapshots`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
    },

    restoreSnapshot(sessionId, snapshotId) {
      return request<Diagram>(`/sessions/${encodeURIComponent(sessionId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`, {
        method: "POST",
      });
    },

    deleteSnapshot(sessionId, snapshotId) {
      return request<Snapshot[]>(`/sessions/${encodeURIComponent(sessionId)}/snapshots/${encodeURIComponent(snapshotId)}`, {
        method: "DELETE",
      });
    },

    subscribe(sessionId, handler) {
      if (typeof window === "undefined" || typeof WebSocket === "undefined") return () => undefined;
      const websocketUrl = apiRoot.replace(/^http/, "ws") + `/sessions/${encodeURIComponent(sessionId)}/events`;
      const socket = new WebSocket(websocketUrl);
      const onMessage = (event: MessageEvent<string>) => {
        try {
          handler(JSON.parse(event.data) as SessionEvent);
        } catch {
          // Ignore malformed events and keep the connection alive.
        }
      };
      socket.addEventListener("message", onMessage);
      const ping = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, 20_000);
      return () => {
        window.clearInterval(ping);
        socket.removeEventListener("message", onMessage);
        socket.close();
      };
    },
  };
}
