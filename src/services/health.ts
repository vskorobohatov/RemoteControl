import type { ServiceHealthConfig } from "./types.js";
import type { ServiceHealth } from "../types.js";

const REQUEST_TIMEOUT_MS = 5_000;

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max)}…`;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(config: ServiceHealthConfig): Promise<ServiceHealth> {
  const checkedAt = Date.now();
  try {
    const response = await fetchWithTimeout(config.url);
    const text = truncate(await response.text(), 4000);
    const detail = parseDetail(text);

    if (!response.ok) {
      return {
        ok: false,
        checkedAt,
        statusCode: response.status,
        detail,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    return { ok: true, checkedAt, statusCode: response.status, detail, error: null };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "request timed out" : String(error);
    return { ok: false, checkedAt, statusCode: null, detail: null, error: reason };
  }
}

function parseDetail(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* Not JSON: expose the raw body so the UI can still show something useful. */
  }
  return { body: trimmed };
}
