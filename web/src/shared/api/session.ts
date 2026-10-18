const SESSION_KEY = "remotecontrol.session";

export function loadSessionToken(): string | null {
  const stored = window.localStorage.getItem(SESSION_KEY);
  return stored === null || stored.length === 0 ? null : stored;
}

export function saveSessionToken(token: string): void {
  window.localStorage.setItem(SESSION_KEY, token);
}

export function clearSessionToken(): void {
  window.localStorage.removeItem(SESSION_KEY);
}
