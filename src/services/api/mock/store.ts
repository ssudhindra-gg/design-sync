import type { SessionEvent, SessionState } from "../types";

const STORAGE_KEY = "sdi.sessions.v1";
const CHANNEL_NAME = "sdi.events.v1";

type Db = Record<string, SessionState>;

const memoryDb: Db = {};

const hasWindow = () => typeof window !== "undefined";

export function readDb(): Db {
  if (!hasWindow()) return memoryDb;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Db) : {};
  } catch {
    return {};
  }
}

export function writeDb(db: Db) {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* quota / private mode — session simply won't persist */
  }
}

let channel: BroadcastChannel | null = null;
const listeners = new Set<(e: SessionEvent) => void>();

function ensureChannel() {
  if (!hasWindow() || channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (msg) => {
    const event = msg.data as SessionEvent;
    listeners.forEach((l) => l(event));
  };
}

export function publish(event: SessionEvent) {
  ensureChannel();
  channel?.postMessage(event);
  listeners.forEach((l) => l(event));
}

export function onEvent(handler: (e: SessionEvent) => void) {
  ensureChannel();
  listeners.add(handler);
  return () => listeners.delete(handler);
}

/** Simulated network latency so the UI is built against realistic timing. */
export function latency(min = 90, max = 260) {
  const ms = min + Math.random() * (max - min);
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
