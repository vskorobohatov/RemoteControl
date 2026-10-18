import { useCallback, useRef, useState } from "react";
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

export function useLogFeed({ fetch, id, logPath }: LogFeedOptions): LogFeed {
  const [log, setLog] = useState<LogPage | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;

  const load = useCallback(async () => {
    setPending(true);
    try {
      setLog(await fetchRef.current());
    } catch (caught) {
      setLog({ id, logPath, lines: [], truncated: false, error: messageOf(caught) });
    } finally {
      setPending(false);
    }
  }, [id, logPath]);

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next && log === null) {
      void load();
    }
  }, [open, log, load]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return { log, open, pending, toggle, refresh };
}
