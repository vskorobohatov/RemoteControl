# Setup

Everything needed to run RemoteControl on your own machine: every configuration key with its
constraints, both launch modes, the systemd unit, the reverse proxy, and troubleshooting. What the
app is and how it works is in [README.md](README.md).

## 1. Requirements

| Requirement | Needed for | Check |
| --- | --- | --- |
| Linux | the `/proc`, `/sys/class/hwmon`, `/sys/class/drm` readers | `uname -s` |
| Node.js >= 22 | server and builds (`engines` in `package.json`) | `node -v` |
| systemd user session with `systemctl --user` and `systemd-run` | every service start and stop | `systemctl --user is-system-running` |
| `rocm-smi` (optional) | GPU metrics fallback | `command -v rocm-smi` |
| Tunnel or reverse proxy (optional) | access from outside `127.0.0.1` | see `server.public_url` |

Missing sensors degrade instead of failing: an unknown `hwmon_label` yields `cpu.temperatureC: null`, and a machine with no readable DRM card and no `rocm-smi` reports `gpu.source: "none"`.

## 2. Create the local config files

| File | Create it from | In git |
| --- | --- | --- |
| `.env` | `.env.example` | ignored |
| `config/config.yaml` | `config/config.yaml.example` | ignored |
| `config/services.yaml` | `config/services.yaml.example` | ignored |
| nginx vhost | `config/nginx.conf.example` | the template is tracked, your copy is not |

```bash
npm install
cp .env.example .env
cp config/config.yaml.example config/config.yaml
cp config/services.yaml.example config/services.yaml
openssl rand -hex 32   # copy the output into RC_AUTH_TOKEN in .env
```

The server refuses to start without both YAML files: `config error: config file not found: <root>/config/config.yaml`.

`.env` is read from the **root directory** (see [Root directory](#5-root-directory)) at startup and never overrides variables already present in the environment. Every `${NAME}` reference used in the YAML files must resolve, otherwise startup stops with `config error: ... environment variable NAME is not set`.

`RC_AUTH_TOKEN` is the token required by all `/api/*` routes except `/api/health`. An empty token does not switch auth off — clients still have to send an empty one — so always set a real value.

Any other variable in `.env` exists only to be referenced from the YAML files. The example service uses `MY_SERVICE_API_KEY`; rename it to whatever your own services need.

## 3. config/config.yaml

| Key | Default | Constraints and notes |
| --- | --- | --- |
| `server.host` | `127.0.0.1` | loopback keeps the dashboard off the LAN; use `0.0.0.0` only if you want LAN access |
| `server.port` | `8790` | 1-65535 |
| `server.public_url` | unset | shown in the dashboard footer; set it to your tunnel URL |
| `auth.token` | `""` | normally `${RC_AUTH_TOKEN}` |
| `metrics.sample_interval_ms` | `2000` | 250-60000, how often a metrics snapshot is taken |
| `metrics.retention_minutes` | `15` | 1-240, size of the in-memory history |
| `metrics.status_interval_ms` | `5000` | 1000-60000, how often unit state and health checks are re-read |
| `metrics.cpu.hwmon_label` | `k10temp` | matched against `/sys/class/hwmon/hwmon*/name`; use `coretemp` on Intel |
| `metrics.gpu.card_path` | `""` (auto-detect) | set explicitly to a device directory such as `/sys/bus/pci/devices/0000:00:01.0` |
| `metrics.gpu.expect_pci_device` | unset | guards auto-detection, e.g. `0x1234`; read yours with `cat /sys/class/drm/card*/device/device` |
| `metrics.gpu.rocm_smi_fallback` | `true` | fall back to `rocm-smi` when sysfs exposes no VRAM nodes |
| `metrics.gpu.rocm_smi_interval_ms` | `10000` | 1000-600000; `rocm-smi` is a subprocess, so keep it slow |
| `services_file` | `config/services.yaml` | resolved against the root directory |
| `update.enabled` | `true` | turns the Self-update panel and its API routes on |
| `update.remote` | `origin` | the git remote that is fetched and compared |
| `update.release_pattern` | `^release_(\d+\.\d+(?:\.\d+)?)$` | which branches count as releases; group 1 must be `X.Y` or `X.Y.Z` |
| `update.allow_dirty` | `false` | `false` blocks an update while the working tree has uncommitted changes |
| `update.run_install` | `true` | run `npm install` when the incoming commits touch `package.json` or a lock file |
| `update.run_build` | `true` | run `npm run build` before restarting |
| `update.restart_unit` | `""` | systemd user unit to restart, e.g. `remotecontrol.service`; see [Self-update](#6-self-update) |
| `update.fetch_timeout_ms` | `30000` | 1000-300000, how long `git fetch` may take |
| `update.auto_check_minutes` | `0` | 0-1440; `0` checks only when the dashboard asks |

Every key is optional; a missing block falls back to the defaults above. Invalid values fail at startup with the exact path, for example `metrics.sample_interval_ms: Number must be greater than or equal to 250`.

## 4. config/services.yaml

Each entry becomes one card in the dashboard and one systemd scope unit.

```yaml
services:
  - id: my-service                    # [a-z0-9-], max 32 chars, must be unique
    name: My Service
    description: What this service is (shown on the card)
    unit: rc-my-service               # optional, defaults to rc-<id>; becomes rc-my-service.scope
    start:
      command: /opt/my-service/start.sh
      args: ["--api-key", "${MY_SERVICE_API_KEY}", "--port", "8092"]
      cwd: /opt/my-service
      env: {}
    stop:
      signal: SIGINT                # SIGINT | SIGTERM | SIGHUP, default SIGINT
      grace_seconds: 90             # 1-900, default 60 -> systemd TimeoutStopSec
    health:
      url: http://127.0.0.1:8092/health
      ready_timeout_seconds: 300    # 5-3600, default 120
    external_stop_command: "pkill -f 'my-service/server.py'"
```

| Key | Required | Notes |
| --- | --- | --- |
| `id` | yes | lowercase letters, digits, dashes; used in URLs and as the log file name |
| `name` | yes | display name |
| `description` | no | shown on the card |
| `unit` | no | defaults to `rc-<id>`; the `.scope` suffix is added automatically |
| `start.command` | yes | an absolute path is safest; `${ENV}` references are expanded |
| `start.args` | no | passed verbatim, no shell parsing |
| `start.cwd` | no | becomes `systemd-run --working-directory` |
| `start.env` | no | injected with `--setenv`, on top of `RC_LOG_PATH` |
| `stop.signal` | no | delivered to the whole control group (`KillMode=control-group`) |
| `stop.grace_seconds` | no | systemd escalates to SIGKILL after this |
| `health` | no | without it a running unit is reported as `running`; with it, as `ready` only when the URL answers |
| `external_stop_command` | no | run through `sh -c` when the unit is not active but the process was started by hand |

Duplicate ids are rejected at startup: `duplicate service ids: a, b`.

## 5. Root directory

`RC_ROOT_DIR` decides where `.env`, `config/`, `logs/` and `dist/client/` are read from. It defaults to the current working directory, which is why `npm start` from the repository root just works:

```bash
RC_ROOT_DIR=/srv/remotecontrol npm start
```

Service logs always land in `<root>/logs/<id>.log`.

## 6. Self-update

The dashboard can update the checkout it is running from: fetch the release branches, check out the newest one,
pull it, rebuild, and restart the server. It is a plain git fast-forward of the working copy - no archives, no
package registry, no second checkout. The panel lives on the **Settings** page; the code is in `src/update/`.

### What counts as a release

`POST /api/update/check` fetches `update.remote` and lists every branch whose name matches
`update.release_pattern`; the first capture group must parse as `major.minor` or `major.minor.patch`. The running
version is the `version` field of `package.json` (`src/appVersion.ts`), so the target is the newest release branch
whose version is **higher** than the running one. Branches are compared as versions, never as strings:
`release_0.10` is newer than `release_0.9`.

Publishing a release therefore means bumping the version and pushing a matching branch:

```bash
# on the development machine
npm version 0.2.0 -m "release v%s"          # bumps package.json, commits, tags v0.2.0
git branch release_0.2 && git push origin release_0.2
```

On the host, open **Settings → Self-update**, press *Check for updates*, then *Update now*. The page reloads itself
once the new version answers.

### What the update does

1. `git fetch <remote>`, then read the release refs and compare HEAD with the target.
2. `git checkout <target>` - a local branch is used as-is; a branch that exists only on the remote is checked out
   as a new tracking branch (git's normal behaviour for an unambiguous name).
3. `git pull --ff-only <remote> <target>` - never a merge: a diverged history stops the update instead of creating
   a merge commit.
4. `npm install --no-audit --no-fund`, but only when the incoming commits touched `package.json` or a lock file.
5. `npm run build`.
6. Restart the server.

Steps 2-6 run in a **separate process** (`src/update/runner.ts`), started as its own transient systemd scope
(`rc-update.scope`) so that it is not in the server unit's cgroup: it has to survive the server it is about to
restart. Every step is appended to `logs/update.log` and recorded in `data/update-status.json`, which is what the
panel renders - including a run that was started by a server process that no longer exists. Both paths are under
the root directory and both are gitignored. There is no CLI for the runner; it is started only by
`POST /api/update/apply`.

### Restart modes

`update.restart_unit` decides how the server comes back:

| How the server runs | `update.restart_unit` | What the runner does |
| --- | --- | --- |
| systemd user service (recommended) | `remotecontrol.service` | `systemctl --user restart remotecontrol` - the only mode that works regardless of how the server was started |
| `npm start` in a terminal | `""` | sends `SIGTERM` to the old server, waits up to 20 s for it to exit, then starts `node dist/server/index.js` detached |
| `npm run dev:server` (`tsx watch`) | `""` | nothing: the watcher restarts the server itself when the pulled sources change, so the runner must not start a competing one |

Set `restart_unit` as soon as you run RemoteControl as a service - a self-update that cannot restart its own unit
is the one thing a watcher cannot do for you. Leave it empty while developing.

### Requirements and limits

- `git` on `PATH`, the root directory is a git work tree, and `update.remote` is reachable **from the host** with
  credentials already configured (SSH key or credential helper) - the update never prompts for anything.
- A clean working tree unless `update.allow_dirty: true`; a detached HEAD blocks the update as well. Both are
  reported as `blocked` with the reason instead of being attempted.
- `git pull --ff-only` never merges, so local commits on the release branch make the check report `ahead` and the
  update is refused. Merge or rebase by hand first.
- A second `POST /api/update/apply` while a run is in flight answers `409`. A run that stops reporting for 20
  minutes is marked failed so the buttons become usable again.
- `update.enabled: false` keeps the routes but reports `unavailable`; the panel then explains why.
- Deleting `data/update-status.json` only forgets the history - the next check rebuilds it.

### API

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/update/status` | last recorded state with the live version overlaid; runs no git commands |
| POST | `/api/update/check` | fetch + compare, returns the full status; concurrent calls share one check |
| POST | `/api/update/apply` | `202` once the runner started; `409` when blocked or already running; `400` for a `target` that is not the newest release |
| GET | `/api/update/log` | `?bytes=1024..2097152`, default 65536 - tail of `logs/update.log` |

`update.auto_check_minutes: 30` makes the server run the check on that schedule, so the panel already shows a
result when you open it. `0`, the default, checks only when the dashboard asks.

## 7. Launch

### Development (two processes, hot reload)

```bash
npm run dev:server   # tsx watch -> http://127.0.0.1:8790
npm run dev:web      # vite      -> http://127.0.0.1:5173
```

Open `http://127.0.0.1:5173` and paste the `RC_AUTH_TOKEN` value into the token gate. Vite proxies `/api` to `http://127.0.0.1:8790`; if you changed `server.port`, point the proxy at the new port:

```bash
RC_PORT=8899 npm run dev:web
```

In this mode the dashboard is not built, so the backend on `:8790` serves only the API.

### Production (one origin)

```bash
npm run build   # tsc -> dist/server, vite -> dist/client
npm start       # node dist/server/index.js
```

`http://127.0.0.1:8790` now serves the API, the SPA, and fallback HTML for client-side routes such as `/services/demo`.

**Restart after every rebuild.** `index.html` is read once at startup, so a fresh `npm run build:web` while the old server is still running serves stale asset hashes and the page 404s.

### Run the backend as a systemd user service (optional)

`~/.config/systemd/user/remotecontrol.service`, with `WorkingDirectory` and `RC_ROOT_DIR` pointing at the directory you cloned the repository into:

```ini
[Unit]
Description=RemoteControl dashboard
After=network.target

[Service]
WorkingDirectory=%h/remotecontrol
Environment=RC_ROOT_DIR=%h/remotecontrol
ExecStart=/usr/bin/node dist/server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now remotecontrol
journalctl --user -u remotecontrol -f
```

To keep RemoteControl and its services running after you log out, enable lingering: `loginctl enable-linger "$USER"`.

With this unit in place, set `update.restart_unit: remotecontrol.service` in `config/config.yaml` so a self-update
can restart the unit it lives in ([Self-update](#6-self-update)).

### Serving the dashboard and another service through one tunnel (nginx)

A Cloudflare tunnel maps one hostname to one origin port, so nginx owns that port and splits it by path. The layout below uses the defaults from `config/config.yaml.example` and the example service on `8092`:

| Role | Address |
| --- | --- |
| Tunnel target (nginx) | `127.0.0.1:8080` |
| RemoteControl dashboard | `127.0.0.1:8790` |
| Example service | `127.0.0.1:8092` |
| Future services | pick any free loopback port |

`config/nginx.conf.example` is the template; copy it to your own conf.d path and replace `dashboard.example.com` with your hostname:

```bash
sudo cp config/nginx.conf.example /etc/nginx/conf.d/dashboard.conf
sudo nginx -t && sudo systemctl reload nginx
```

On SELinux systems nginx may not be allowed to bind an unlabelled port or to open outbound connections:

```bash
sudo semanage port -a -t http_port_t -p tcp 8080
sudo setsebool -P httpd_can_network_connect 1   # only if nginx is denied outbound connections
```

Then point the tunnel at `http://localhost:8080` and make sure the hostname is listed in the tunnel ingress; a hostname that is missing there returns Cloudflare error `1033`.

#### Request routing scheme

One hostname, one tunnel, one origin port. nginx owns `8080` and splits by path; `8790` and `8092` stay on loopback.

```text
https://dashboard.example.com/<path>
        |
        v
Cloudflare edge -- tunnel --> 127.0.0.1:8080   nginx (config/nginx.conf.example)
        |
        +-- location = /my-service    -> 301 Location: /my-service/   (the client retries)
        |
        +-- location /my-service/  \   -> proxy_pass http://127.0.0.1:8092/   prefix stripped
        |      /my-service/health              -> 8092  /health
        |      /my-service/v1/models           -> 8092  /v1/models               Bearer MY_SERVICE_API_KEY
        |      /my-service/v1/chat/completions -> 8092  /v1/chat/completions    Bearer MY_SERVICE_API_KEY
        |
        +-- location /            -> proxy_pass http://127.0.0.1:8790    path unchanged
               /                     -> 8790  dist/client/index.html   SPA shell
               /assets/index-<hash>.js   -> 8790  dist/client/assets/...   static file
               /api/services             -> 8790  Fastify route, Bearer RC_AUTH_TOKEN
               /api/events               -> 8790  SSE stream, ?token= accepted
               /<anything else>          -> 8790  no route -> index.html (SPA fallback)
```

nginx decides on the **path only**. The query string is never part of that decision and is forwarded untouched; `Host` is whatever the client asked for, and `proxy_set_header Host $host;` passes your hostname on. The order it tries is:

1. `location = <exact>` - exact match, beats every other kind. `location = /my-service` exists because `/my-service` without the trailing slash does not match the `/my-service/` prefix; without that line it falls into `location /` and returns the dashboard instead of the service.
2. Longest prefix match - `/my-service/` wins over `/` for anything starting with `/my-service/`, no matter where the blocks sit in the file.
3. Regex locations (`location ~ ...`) - none used here.
4. What reaches the upstream depends on `proxy_pass`:
   - `proxy_pass http://127.0.0.1:8092/;` carries a URI (the trailing `/`), so nginx replaces the matched prefix with it: `/my-service/v1/models` becomes `/v1/models`. Drop the slash and the service receives `/my-service/v1/models` and answers 404.
   - `proxy_pass http://127.0.0.1:8790;` carries no URI, so the original path is forwarded verbatim.

The dashboard hangs off `/`, so its own calls (`/api/...` in `web/src/api.ts`) are relative and behave the same on `http://127.0.0.1:8790` and through the tunnel - the SPA needs no base path. A path with no API route is just another match for `location /`; Fastify answers it with `index.html` and the SPA decides what to render.

To add a service: copy the `/my-service/` block, change the location prefix and the upstream port, keep the trailing slash on `proxy_pass`, and leave `location /` as the catch-all.

A service reached through such a prefix is addressed from another machine as `<public prefix>` plus whatever the service serves once the prefix is stripped - for an OpenAI-compatible server that is `https://dashboard.example.com/my-service/v1`, and clients append `/models` and `/chat/completions` to it. The key it expects is the service's own key, not `RC_AUTH_TOKEN`: RemoteControl is not in that path at all.

### Verify it works

```bash
TOKEN=$(sed -n 's/^RC_AUTH_TOKEN=//p' .env)
curl -s localhost:8790/api/health
curl -s -H "Authorization: Bearer $TOKEN" localhost:8790/api/system
curl -sN "localhost:8790/api/events?token=$TOKEN" --max-time 5
```

Expected: `{"ok":true,...}`, a system object containing `hostname`, `cpuModel` and GPU fields, and an SSE stream that opens with `event: hello` followed by `metrics` events every `sample_interval_ms`.

### Stopping

`Ctrl+C` (or `SIGTERM`) stops the sampler and closes the API. Managed services keep running: they are systemd scopes, not children of the server, and they are re-adopted on the next start.

## 8. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `config error: config file not found: ...` | the `.example` files were not copied into `config/` |
| `config error: ... environment variable RC_AUTH_TOKEN is not set` | no `.env` in the root directory, or `RC_ROOT_DIR` points somewhere else |
| `401 unauthorized` in the dashboard | the token typed into the gate does not match `auth.token`; re-enter it |
| `Failed to create bus connection`, `Unknown user` | no systemd user session; run inside a login session where `XDG_RUNTIME_DIR` is set, or enable lingering |
| `unit rc-x.scope did not become active within 10s` | the command exits immediately; read `logs/<id>.log` and `journalctl --user -u rc-x.scope` |
| Service shows `failed` with a `lastExitCode` | the command itself failed; its output is in the log file |
| `cpu.temperatureC` is `null` | wrong `metrics.cpu.hwmon_label`; list what exists with `cat /sys/class/hwmon/hwmon*/name` |
| `gpu.source: "none"` | no DRM card exposing VRAM nodes and no `rocm-smi`; set `metrics.gpu.card_path` explicitly |
| Blank page or 404 assets after a rebuild | the server still holds the old `index.html`; restart it |
| `EADDRINUSE` on startup | another instance is running: `ss -ltnp \| grep -E ':8790'` |
| `502` through the tunnel while `http://127.0.0.1:8790/api/health` is fine | nginx cannot reach the upstream: `sudo setsebool -P httpd_can_network_connect 1`, and label the listen port with `sudo semanage port -a -t http_port_t -p tcp 8080` |
| Cloudflare `error code: 1033` | the hostname is missing from the tunnel ingress, or nothing listens on the origin port |
| `no log file yet` | the service never started, or `RC_ROOT_DIR` changed and the logs live under the old root |
| Self-update reports `git is unavailable or this checkout is not a git work tree` | `git` is not on `PATH`, or the directory was copied instead of cloned; install git and `git clone` the repository |
| `git fetch failed: ...` | the host cannot reach `update.remote` or has no credentials for it; test it by hand with `git -C <root> fetch origin` |
| `no release branch newer than v0.1.0 was found` | nothing matching `update.release_pattern` was pushed, or its `package.json` version is not higher; list what exists with `git -C <root> ls-remote --heads origin` |
| `the working tree has uncommitted changes` | commit or stash first, or set `update.allow_dirty: true` if you accept losing them |
| `HEAD is detached; check out a branch first` | the server runs on a detached commit; `git switch release_0.1` (or your development branch) before updating |
| `Update now` stays disabled with `409` | a run is already in flight, or the check reported a blocker; read the message under the version line |
| The update finished but the server did not come back | the runner could not restart the server: set `update.restart_unit`, then read `logs/update.log` and `journalctl --user -u remotecontrol` |
| The panel stays on `applying…` | the runner died mid-run; read `logs/update.log`. It is marked failed after 20 minutes, or delete `data/update-status.json` to reset the panel |
| `update runner not found; run npm run build first` | `dist/server/update/runner.js` is missing and `src/update/runner.ts` could not be used instead; run `npm run build` |
