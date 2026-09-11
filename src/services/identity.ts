const key = (sessionId: string) => `sdi.me.${sessionId}`;

export function rememberMe(sessionId: string, participantId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key(sessionId), participantId);
}

export function recallMe(sessionId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key(sessionId));
}

export function forgetMe(sessionId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key(sessionId));
}
