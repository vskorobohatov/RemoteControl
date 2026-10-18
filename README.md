# RemoteControl

A self-hosted dashboard for one Linux machine: live CPU / memory / GPU metrics plus start-stop control of the long-running local services you declare in `config/services.yaml` (LLM servers, inference APIs, agents, dev daemons). The Settings page can also update the checkout the server is running from - check out the newest `release_*` branch, pull it, rebuild and restart.

- **Backend** (`src/`) — Node 22 + Fastify. Serves the JSON API, an SSE event stream, and the built dashboard from one origin.
- **Frontend** (`web/`) — React + Vite single-page app: a dashboard route and a Settings route (self-update panel).
- **Services** are not plain child processes. Each one becomes a transient **systemd user scope** (`rc-<id>.scope`), so it keeps running when the dashboard restarts and is stopped with the exact signal and grace period you configured.
- **Service links** — when `server.public_url` is set, every card shows `<origin of public_url>/<service id>` with a copy button under its description. The id is the path, so it is the path your proxy has to route; see [SETUP.md - Service links](SETUP.md#service-links).

Metrics come from `/proc`, `/sys/class/hwmon` and `/sys/class/drm`, with an optional `rocm-smi` fallback. Missing sensors degrade instead of failing: an unknown `hwmon_label` yields `cpu.temperatureC: null`, a machine without a readable DRM card reports `gpu.source: "none"`.

## Requirements

| Requirement | Needed for | Check |
| --- | --- | --- |
| Linux | the `/proc`, `/sys/class/hwmon`, `/sys/class/drm` readers | `uname -s` |
| Node.js >= 22 | server and builds (`engines` in `package.json`) | `node -v` |
| systemd user session with `systemctl --user` and `systemd-run` | every service start and stop | `systemctl --user is-system-running` |
| `rocm-smi` (optional) | GPU metrics fallback | `command -v rocm-smi` |
| Tunnel or reverse proxy (optional) | access from outside `127.0.0.1` | see `server.public_url` |
| `git` + a reachable remote | the self-update on the Settings page | `git -C <root> remote -v` |

## Quick start

```bash
cp .env.example .env
cp config/config.yaml.example config/config.yaml
cp config/services.yaml.example config/services.yaml
# put a real token in .env:  openssl rand -hex 32
npm install
npm run build
npm start          # http://127.0.0.1:8790 - API, dashboard and SSE on one origin
```

Open the dashboard and paste the `RC_AUTH_TOKEN` value into the token gate.

The three real config files are gitignored on purpose, so a fresh clone has to copy them from the `.example` templates first; until they exist the server exits with `config error: config file not found: ...`.

## Configuration files

| File | Create it from | Contents |
| --- | --- | --- |
| `.env` | `.env.example` | secrets referenced as `${NAME}` from the YAML files |
| `config/config.yaml` | `config/config.yaml.example` | listen address, auth token, sampling intervals, sensor hints, self-update rules |
| `config/services.yaml` | `config/services.yaml.example` | the services that become cards and systemd scopes |
| `config/nginx.conf.example` | tracked template | optional vhost that puts the dashboard and a service behind one port |

Only the `.example` templates are tracked: the real files hold hostnames, absolute paths and tokens. Nothing under `src/`, `web/` or `test/` contains machine-specific values.

## How a service is started and stopped

1. `POST /api/services/<id>/start` runs `systemd-run --user --scope --unit <unit>.scope --collect` with `KillSignal=<stop.signal>`, `KillMode=control-group`, `TimeoutStopSec=<grace_seconds>`, `--setenv RC_LOG_PATH=<root>/logs/<id>.log`, plus your `start.env` and `start.cwd`.
2. The command is wrapped so both streams land in the log file: `sh -c 'exec "$@" >>"$RC_LOG_PATH" 2>&1' _ <command> <args...>`.
3. `systemd-run` stays alive as a supervisor so the exit code stays observable; the manager polls `systemctl --user is-active` every 250 ms and gives up after 10 s.
4. Status follows the health checks: `starting` until `health.url` answers, `ready` once it does, `degraded` when a previously ready service stops answering, `running` when no health URL is configured, `failed` with `lastExitCode` on a non-zero exit.
5. `POST /api/services/<id>/stop` runs `systemctl --user stop <unit>.scope`; if the unit is not loaded and `external_stop_command` is set, that command runs instead.
6. On startup, units that are already active are adopted as `managedBy: "external"` instead of restarted.

Statuses: `stopped`, `starting`, `running`, `ready`, `degraded`, `stopping`, `failed`, `external`.

## API

All `/api/*` routes except `/api/health` require `Authorization: Bearer <token>`. `EventSource` cannot send headers, so `/api/events` also accepts `?token=<token>`. A missing or wrong token returns `401 {"error":"unauthorized"}`.

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/health` | liveness, no auth |
| GET | `/api/system` | hostname, CPU model, core count, GPU identity |
| GET | `/api/metrics/latest` | newest snapshot |
| GET | `/api/metrics/history` | `?minutes=1..240`, default 15 |
| GET | `/api/services` | all services with status and the derived access `link` |
| GET | `/api/services/:id` | one service |
| POST | `/api/services/:id/start` | 202 while loading, 200 when ready |
| POST | `/api/services/:id/stop` | 202 while stopping, 200 when stopped |
| GET | `/api/services/:id/logs` | `?lines=1..500`, default 120 |
| GET | `/api/update/status` | last self-update state plus the running version |
| POST | `/api/update/check` | fetch the release branches and compare them with this checkout |
| POST | `/api/update/apply` | 202 once the update runner started, 409 when blocked or already running |
| GET | `/api/update/log` | `?bytes=1024..2097152`, default 65536 |
| GET | `/api/events` | SSE stream |

Every SSE frame is `{ "kind": ..., "ts": ..., "payload": ... }`, where `kind` is `hello`, `metrics`, `service` or `notice`. Shapes are defined in `src/types.ts`:

```ts
// kind: "hello"   -> { services: ServiceStatus[], system: SystemInfo, server: { publicUrl: string | null } }
// kind: "service" -> ServiceStatus
// kind: "notice"  -> { level: "info" | "warn" | "error", message: string }
// kind: "metrics" -> MetricsSnapshot
{
  ts: number, cpu: { load1: number, load5: number, load15: number, coreCount: number,
       temperatureC: number | null, perCoreTempC: number[] | null },
  memory: { totalBytes: number, availableBytes: number, usedBytes: number },
  swap: { totalBytes: number, usedBytes: number },
  gpu: { available: boolean, source: "sysfs" | "rocm-smi" | "none", name: string | null,
         vramTotalBytes: number | null, vramUsedBytes: number | null,
         utilizationPercent: number | null, temperatureC: number | null },
  services: { total: number, running: number, ready: number, failed: number }
}
```

## Self-update

The Settings page updates the checkout the server itself runs from. A release is a branch named `release_<version>`
whose `package.json` carries that version, and the running version is the `version` field of the `package.json` in
the root directory. *Check for updates* fetches `update.remote` and selects the newest release branch above the
running version; *Update now* runs `git checkout`, `git pull --ff-only`, `npm install` when the incoming commits
touched a manifest, `npm run build`, and then restarts the server.

That work happens in its own process (`src/update/runner.ts`, started as the transient scope `rc-update.scope`) so
it survives the server it restarts, and every step lands in `logs/update.log` and `data/update-status.json` - the
new server reads them and the panel reports what happened. How the server comes back depends on
`update.restart_unit`: a systemd unit is restarted, a plain `npm start` process is relaunched, and a `tsx watch`
session is left to its watcher. [SETUP.md - Self-update](SETUP.md#6-self-update) covers the modes, the limits
(clean tree, fast-forward only, pre-configured credentials) and every failure message.

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev:server` | `tsx watch src/index.ts` — API only, on `server.port` |
| `npm run dev:web` | Vite dev server on `:5173`, `/api` proxied to `http://127.0.0.1:8790` |
| `npm run build` | `tsc -p tsconfig.server.json` + `vite build` |
| `npm start` | `node dist/server/index.js` — API and dashboard on one port |
| `npm run typecheck` | `tsc --noEmit` over both configs |
| `npm test` | `node --import tsx --test test/*.test.ts` (node:test, no server needed) |

## Layout

```
src/            Fastify server, config loader, systemd unit manager, /proc and /sys readers
src/update/     self-update: release-branch resolution, git steps, runner process, restart
web/            React SPA (dashboard route, settings route, service cards, charts)
dist/           build output: dist/server (node) + dist/client (static assets)
config/         *.example templates; the real config.yaml and services.yaml are local
logs/           one file per service plus update.log, created at runtime (ignored)
data/           update-status.json, written by the update runner (ignored)
test/           node:test suites (pure logic and git parsing, no server required)
SETUP.md        configuration reference, launch modes, systemd unit, nginx tunnel, troubleshooting
```

## Setup guide

[SETUP.md](SETUP.md) covers every configuration key with its constraints, the development workflow, running the backend as a systemd user service, the nginx + tunnel routing scheme, verification commands, and troubleshooting.
