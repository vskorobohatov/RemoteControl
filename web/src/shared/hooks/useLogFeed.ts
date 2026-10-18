import { useCallback, useEffect, useRef, useState } from "react";
import type { LogPage } from "@server/types";
import { messageOf } from "../api/client";

interface LogFeedOptions {
  fetch: () => Promise<LogPage>;
  id: string;
  logPath: string;
}

export interface LogFeed {
  log: LogPage | null;
  open: boolean;
  pending: boolean;
  toggle: () => void;
  refresh: () => void;
}

interface LoadOptions {
  background?: boolean;
}

/* A log is only worth reading while it is on screen, so the feed runs only while the
   viewer is open: read once the moment it opens, then every two seconds, and ask for
   nothing at all while it is hidden. */
const REFRESH_INTERVAL_MS = 2_000;

export function useLogFeed({ fetch, id, logPath }: LogFeedOptions): LogFeed {
  const [log, setLog] = useState<LogPage | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;

  /* Never two reads at once, and never a scheduled one right after a manual refresh. */
  const inFlight = useRef(false);
  const lastFetchAt = useRef(0);

  const load = useCallback(
    async ({ background = false }: LoadOptions = {}) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      lastFetchAt.current = Date.now();
      /* Only a read the reader asked for is worth showing as pending. */
      if (!background) {
        setPending(true);
      }
      try {
        setLog(await fetchRef.current());
      } catch (caught) {
        /* A failed poll must not blank the log the reader is looking at. */
        setLog((previous) =>
          background && previous !== null
            ? { ...previous, error: messageOf(caught) }
            : { id, logPath, lines: [], truncated: false, error: messageOf(caught) },
        );
      } finally {
        inFlight.current = false;
        if (!background) {
          setPending(false);
        }
      }
    },
    [id, logPath],
  );

  const tick = useCallback(() => {
    if (Date.now() - lastFetchAt.current < REFRESH_INTERVAL_MS) {
      return;
    }
    void load({ background: true });
  }, [load]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void load();
    const timer = window.setInterval(() => tick(), REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [open, load, tick]);

  const toggle = useCallback(() => {
    setOpen((value) => !value);
  }, []);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return { log, open, pending, toggle, refresh };
}
