const CACHE_PREFIX = "remotecontrol.cache.";

export function readCache<T>(key: string): T | null {
  const stored = window.localStorage.getItem(CACHE_PREFIX + key);
  if (stored === null) {
    return null;
  }
  try {
    return JSON.parse(stored) as T;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* A full or blocked storage only costs the offline copy, never the live view. */
  }
}

export function clearDataCache(): void {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(CACHE_PREFIX)) {
      window.localStorage.removeItem(key);
    }
  }
}
