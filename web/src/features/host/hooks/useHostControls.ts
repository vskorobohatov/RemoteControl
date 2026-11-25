import { useCallback, useEffect, useState } from "react";
import type { PowerStatus } from "@server/types";
import { messageOf } from "@shared/api/client";
import { fetchPowerStatus, restartHost, shutdownHost } from "../api";

export type PowerAction = "shutdown" | "restart";

export interface HostController {
  status: PowerStatus | null;
  error: string | null;
  busy: boolean;
  /** What the host agreed to. Once it is set the machine is going away, so the card stops offering anything. */
  requested: string | null;
  run: (action: PowerAction) => Promise<void>;
}

export function useHostControls(): HostController {
  const [status, setStatus] = useState<PowerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState<string | null>(null);

  /* logind decides this, not the server, so the card asks before it offers a button. */
  useEffect(() => {
    let disposed = false;
    void fetchPowerStatus()
      .then((next) => {
        if (!disposed) {
          setStatus(next);
        }
      })
      .catch((caught: unknown) => {
        if (!disposed) {
          setError(messageOf(caught));
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  const run = useCallback(async (action: PowerAction): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = action === "shutdown" ? await shutdownHost() : await restartHost();
      /* Deliberately left busy: a host that agreed is on its way out, and a second press
         would only meet a server that is already going with it. */
      setRequested(result.message);
    } catch (caught) {
      setError(messageOf(caught));
      setBusy(false);
    }
  }, []);

  return { status, error, busy, requested, run };
}
