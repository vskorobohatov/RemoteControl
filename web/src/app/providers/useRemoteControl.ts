import { useCallback, useEffect, useState } from "react";
import type { MetricsSnapshot, Permission, ServiceState, SessionResponse } from "@server/types";
import { isUnauthorized, messageOf } from "@shared/api/client";
import { openEventStream } from "@shared/api/events";
import { clearSessionToken, loadSessionToken, saveSessionToken } from "@shared/api/session";
import { bootstrapAccount, fetchAuthStatus, fetchSession, login as loginWithPassword, logout } from "@features/auth/api";
import { fetchHistory } from "@features/metrics/api";
import { fetchServices, startService, stopService } from "@features/services/api";
import { fetchSystem, type SystemResponse } from "@features/system/api";

export type ConnectionStatus = "needs-account" | "connecting" | "live" | "reconnecting" | "offline";

export interface Notice {
  id: number;
  message: string;
}

export interface RemoteControl {
  status: ConnectionStatus;
  needsBootstrap: boolean;
  session: SessionResponse | null;
  can: (permission: Permission) => boolean;
  system: SystemResponse | null;
  services: ServiceState[];
  series: MetricsSnapshot[];
  sampleIntervalMs: number | null;
  notices: Notice[];
  error: string | null;
  signIn: (login: string, password: string) => Promise<void>;
  createFirstAccount: (login: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  reconnect: () => void;
  start: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
}

const MAX_POINTS = 900;
const POLL_INTERVAL_MS = 5000;
const RETRY_DELAY_MS = 4000;

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
  /* The token is what requests carry, the session is what the UI is allowed to show.
     They are set and cleared together: a token without a session is a signed-out client. */
  const [token, setToken] = useState<string | null>(() => loadSessionToken());
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus>(() =>
    loadSessionToken() === null ? "needs-account" : "connecting",
  );
  const [system, setSystem] = useState<SystemResponse | null>(null);
  const [services, setServices] = useState<ServiceState[]>([]);
  const [series, setSeries] = useState<MetricsSnapshot[]>([]);
  const [sampleIntervalMs, setSampleIntervalMs] = useState<number | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [error, setError] = useState<string | null>(null);

  const can = useCallback(
    (permission: Permission): boolean => session?.permissions.includes(permission) ?? false,
    [session],
  );

  const clearData = useCallback(() => {
    setSystem(null);
    setServices([]);
    setSeries([]);
    setSampleIntervalMs(null);
  }, []);

  const pushNotice = useCallback((message: string) => {
    setNotices((previous) => [...previous.slice(-4), { id: Date.now(), message }]);
  }, []);

  /* Who is this, and does the server even have accounts yet? Runs on mount and on every
     manual reconnect, so a server that was down comes back without a page reload. */
  useEffect(() => {
    let disposed = false;

    const resolve = async () => {
      if (loadSessionToken() !== null) {
        try {
          const existing = await fetchSession();
          if (!disposed) {
            setSession(existing);
            setNeedsBootstrap(false);
            setError(null);
          }
          return;
        } catch (caught) {
          if (!isUnauthorized(caught)) {
            if (!disposed) {
              setError(messageOf(caught));
              setStatus("offline");
            }
            return;
          }
          /* Expired or revoked: drop it and fall through to the sign-in form. */
          clearSessionToken();
          setToken(null);
        }
      }

      try {
        const auth = await fetchAuthStatus();
        if (!disposed) {
          setNeedsBootstrap(auth.needsBootstrap);
          setStatus("needs-account");
          setError(null);
        }
      } catch (caught) {
        if (!disposed) {
          setError(messageOf(caught));
          setStatus("offline");
        }
      }
    };

    void resolve();
    return () => {
      disposed = true;
    };
  }, [attempt]);

  const bootstrap = useCallback(
    async (onSessionExpired: () => void): Promise<void> => {
      try {
        const serviceList = await fetchServices();
        setServices(serviceList.services);
        setError(null);
        setStatus("live");
      } catch (caught) {
        if (isUnauthorized(caught)) {
          onSessionExpired();
          return;
        }
        setError(messageOf(caught));
        setStatus("offline");
      }
    },
    [],
  );

  /* The machine report is guarded by metrics:view exactly like the history is, so a role
     that may not read it simply gets no runtime panel instead of an error. */
  const loadSystem = useCallback(async (): Promise<void> => {
    try {
      setSystem(await fetchSystem());
    } catch (caught) {
      if (!isUnauthorized(caught)) {
        return;
      }
      setSystem(null);
    }
  }, []);

  /* Telemetry is a separate request because a role without metrics:view is refused,
     and a refused history must not take the service list down with it. */
  const loadHistory = useCallback(async (): Promise<void> => {
    try {
      const history = await fetchHistory();
      setSeries(history.points);
      setSampleIntervalMs(history.sampleIntervalMs);
    } catch (caught) {
      if (!isUnauthorized(caught)) {
        return;
      }
      setSeries([]);
      setSampleIntervalMs(null);
    }
  }, []);

  useEffect(() => {
    if (token === null) {
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

    const signOutLocally = () => {
      if (disposed) {
        return;
      }
      clearSessionToken();
      setToken(null);
      setSession(null);
      clearData();
      setStatus("needs-account");
    };

    void bootstrap(signOutLocally);
    if (session !== null && session.permissions.includes("metrics:view")) {
      void loadHistory();
      void loadSystem();
    }

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
  }, [token, session, attempt, bootstrap, clearData, loadHistory, loadSystem, pushNotice]);

  const startSession = useCallback(
    (result: SessionResponse & { token: string }) => {
      saveSessionToken(result.token);
      clearData();
      setError(null);
      setStatus("connecting");
      setSession(result);
      setToken(result.token);
    },
    [clearData],
  );

  const signIn = useCallback(
    async (login: string, password: string) => {
      startSession(await loginWithPassword(login, password));
    },
    [startSession],
  );

  const createFirstAccount = useCallback(
    async (login: string, password: string) => {
      startSession(await bootstrapAccount(login, password));
    },
    [startSession],
  );

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch {
      /* The server may already be gone; the local session has to end either way. */
    }
    clearSessionToken();
    setToken(null);
    setSession(null);
    clearData();
    setNotices([]);
    setStatus("needs-account");
  }, [clearData]);

  /* Changing your own role or password revokes the token you are holding, so the page
     has to find out right away instead of waiting for the next request to be refused. */
  const refreshSession = useCallback(async () => {
    if (loadSessionToken() === null) {
      return;
    }
    try {
      setSession(await fetchSession());
    } catch (caught) {
      if (isUnauthorized(caught)) {
        clearSessionToken();
        setToken(null);
        setSession(null);
        clearData();
        setStatus("needs-account");
      }
    }
  }, [clearData]);

  const reconnect = useCallback(() => {
    setError(null);
    setStatus(token === null ? "needs-account" : "connecting");
    setAttempt((value) => value + 1);
  }, [token]);

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
    needsBootstrap,
    session,
    can,
    system,
    services,
    series,
    sampleIntervalMs,
    notices,
    error,
    signIn,
    createFirstAccount,
    signOut,
    refreshSession,
    reconnect,
    start,
    stop,
  };
}

