import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  clearToken,
  fetchHistory,
  fetchServices,
  fetchSystem,
  loadToken,
  openEventStream,
  saveToken,
  startService,
  stopService,
  type SystemResponse,
} from "./api";
import type { MetricsSnapshot, ServiceState } from "../../src/types";

export type ConnectionStatus = "needs-token" | "connecting" | "live" | "reconnecting" | "offline";

export interface Notice {
  id: number;
  message: string;
}

export interface RemoteControl {
  status: ConnectionStatus;
  system: SystemResponse | null;
  services: ServiceState[];
  series: MetricsSnapshot[];
  sampleIntervalMs: number | null;
  notices: Notice[];
  error: string | null;
  provideToken: (token: string) => void;
  forgetToken: () => void;
  reconnect: () => void;
  start: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
}

const MAX_POINTS = 900;
const POLL_INTERVAL_MS = 5000;
const RETRY_DELAY_MS = 4000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function upsertService(list: ServiceState[], next: ServiceState): ServiceState[] {
  const index = list.findIndex((item) => item.id === next.id);
  if (index === -1) {
    return [...list, next];
  }
  const copy = list.slice();
  copy[index] = next;
  return copy;
}

function appendPoint(list: MetricsSnapshot[], next: MetricsSnapshot): MetricsSnapshot[] {
  const last = list.at(-1);
  if (last !== undefined && last.t >= next.t) {
    return list;
  }
  const grown = [...list, next];
  return grown.length > MAX_POINTS ? grown.slice(grown.length - MAX_POINTS) : grown;
}

export function useRemoteControl(): RemoteControl {
  const [token, setToken] = useState<string | null>(() => loadToken());
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus>(() => (loadToken() === null ? "needs-token" : "connecting"));
  const [system, setSystem] = useState<SystemResponse | null>(null);
  const [services, setServices] = useState<ServiceState[]>([]);
  const [series, setSeries] = useState<MetricsSnapshot[]>([]);
  const [sampleIntervalMs, setSampleIntervalMs] = useState<number | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [error, setError] = useState<string | null>(null);

  const pushNotice = useCallback((message: string) => {
    setNotices((previous) => [...previous.slice(-4), { id: Date.now(), message }]);
  }, []);

  const bootstrap = useCallback(
    async (onTokenRejected: () => void): Promise<void> => {
      try {
        const [systemInfo, serviceList, history] = await Promise.all([fetchSystem(), fetchServices(), fetchHistory()]);
        setSystem(systemInfo);
        setServices(serviceList.services);
        setSeries(history.points);
        setSampleIntervalMs(history.sampleIntervalMs);
        setError(null);
        setStatus("live");
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          onTokenRejected();
          return;
        }
        setError(messageOf(caught));
        setStatus("offline");
      }
    },
    [],
  );

  useEffect(() => {
    if (token === null) {
      setStatus("needs-token");
      return;
    }

    let disposed = false;
    let retryTimer: number | null = null;
    let pollTimer: number | null = null;

    const scheduleRetry = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      retryTimer = window.setTimeout(() => setAttempt((value) => value + 1), RETRY_DELAY_MS);
    };

    void bootstrap(() => {
      if (disposed) {
        return;
      }
      clearToken();
      setToken(null);
      setStatus("needs-token");
    });

    pollTimer = window.setInterval(() => {
      void fetchServices()
        .then((result) => {
          if (!disposed) {
            setServices(result.services);
          }
        })
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);

    const stream = openEventStream(token, {
      onService: (service) => {
        if (!disposed) {
          setServices((previous) => upsertService(previous, service));
        }
      },
      onMetrics: (snapshot) => {
        if (!disposed) {
          setSeries((previous) => appendPoint(previous, snapshot));
        }
      },
      onNotice: (message) => {
        if (!disposed) {
          pushNotice(message);
        }
      },
      onOpen: () => {
        if (!disposed) {
          setStatus("live");
        }
      },
      onDisconnect: (terminal) => {
        if (disposed) {
          return;
        }
        setStatus("reconnecting");
        /* EventSource retries by itself unless the browser closed it for good. */
        if (terminal) {
          scheduleRetry();
        }
      },
    });

    return () => {
      disposed = true;
      stream.close();
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [token, attempt, bootstrap, pushNotice]);

  const provideToken = useCallback((value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return;
    }
    saveToken(trimmed);
    setError(null);
    setStatus("connecting");
    setToken(trimmed);
  }, []);

  const forgetToken = useCallback(() => {
    clearToken();
    setSystem(null);
    setServices([]);
    setSeries([]);
    setSampleIntervalMs(null);
    setToken(null);
    setStatus("needs-token");
  }, []);

  const reconnect = useCallback(() => {
    setError(null);
    setStatus("connecting");
    setAttempt((value) => value + 1);
  }, []);

  const runAction = useCallback(
    async (id: string, action: (id: string) => Promise<{ service: ServiceState; message: string }>) => {
      try {
        const result = await action(id);
        setServices((previous) => upsertService(previous, result.service));
        if (result.message.length > 0) {
          pushNotice(`${id}: ${result.message}`);
        }
      } catch (caught) {
        pushNotice(`${id}: ${messageOf(caught)}`);
      }
    },
    [pushNotice],
  );

  const start = useCallback(async (id: string) => runAction(id, startService), [runAction]);
  const stop = useCallback(async (id: string) => runAction(id, stopService), [runAction]);

  return {
    status,
    system,
    services,
    series,
    sampleIntervalMs,
    notices,
    error,
    provideToken,
    forgetToken,
    reconnect,
    start,
    stop,
  };
}

