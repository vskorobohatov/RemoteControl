import { useCallback, useEffect, useRef, useState } from "react";
import { applyUpdate, checkForUpdates, fetchUpdateStatus, resetUpdateStatus } from "../api";
import type { UpdateStatus } from "../../../src/types";

export const ACTIVE_PHASES = new Set(["checking", "applying", "restarting"]);

const POLL_INTERVAL_MS = 2_000;

export interface UpdateController {
  status: UpdateStatus | null;
  error: string | null;
  /** True while an update is running, here or in another process. */
  busy: boolean;
  /** True only while a check request is in flight or a live run holds the checkout.
     A stale recorded state must never disable this: checking is how the panel recovers. */
  checkBusy: boolean;
  check: () => Promise<void>;
  apply: () => Promise<void>;
  reset: () => Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useUpdate(): UpdateController {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);
  const pollTimer = useRef<number | null>(null);
  /* The version this client was loaded with; a different version means the server
     already restarted and the page has to be reloaded to match it. */
  const baselineVersion = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const refresh = useCallback(async (): Promise<UpdateStatus | null> => {
    try {
      const next = await fetchUpdateStatus();
      setStatus(next);

      if (baselineVersion.current !== null && next.currentVersion !== baselineVersion.current) {
        baselineVersion.current = null;
        stopPolling();
        window.location.reload();
      } else if (!ACTIVE_PHASES.has(next.phase)) {
        stopPolling();
      }
      return next;
    } catch (caught) {
      /* The server may be mid-restart here, so a failed poll is retried, not fatal. */
      setError(messageOf(caught));
      return null;
    }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      return;
    }
    pollTimer.current = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
  }, [refresh]);

  useEffect(() => {
    void refresh().then((initial) => {
      if (initial !== null && ACTIVE_PHASES.has(initial.phase)) {
        startPolling();
      }
    });
    return stopPolling;
  }, [refresh, startPolling, stopPolling]);

  const check = useCallback(async () => {
    setCheckBusy(true);
    setError(null);
    try {
      setStatus(await checkForUpdates());
    } catch (caught) {
      setError(messageOf(caught));
      await refresh();
    } finally {
      setCheckBusy(false);
    }
  }, [refresh]);

  const apply = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await applyUpdate();
      baselineVersion.current = result.status.currentVersion;
      setStatus(result.status);
      startPolling();
    } catch (caught) {
      setError(messageOf(caught));
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh, startPolling]);

  /* Forgets a recorded state the panel cannot get out of by itself. */
  const reset = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await resetUpdateStatus());
      stopPolling();
    } catch (caught) {
      setError(messageOf(caught));
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh, stopPolling]);

  /* A phase that claims work is in progress. Only a run that is still running is a
     real reason to leave the checkout alone: a leftover phase must not block a new
     check, because checking is the way out of it. */
  const claimed = status !== null && ACTIVE_PHASES.has(status.phase);
  const liveRun = claimed && status !== null && status.lastRun !== null && status.lastRun.status === "running";

  return { status, error, busy: busy || claimed, checkBusy: checkBusy || liveRun, check, apply, reset };
}