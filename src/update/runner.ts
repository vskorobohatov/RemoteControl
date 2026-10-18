import path from "node:path";
import { readAppVersion } from "../appVersion.js";
import { loadConfig, type AppConfig } from "../config.js";
import type { UpdateRun, UpdateStatus } from "../types.js";
import { checkoutBranch, changedFiles, pullFastForward, readGitInfo, runNpm } from "./git.js";
import { applyRestart, parseRestartMode, RESTART_MODE_ENV, ROOT_DIR_ENV, SERVER_PID_ENV, type RestartRequest } from "./restart.js";
import { MAX_STEP_LOG, touchesManifests } from "./refs.js";
import { UpdateStatusStore } from "./store.js";

const INSTALL_TIMEOUT_MS = 600_000;
const BUILD_TIMEOUT_MS = 600_000;
const DETAIL_LIMIT = 4_000;

const log = (message: string): void => {
  console.log(`[${new Date().toISOString()}] update runner: ${message}`);
};

const flag = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value ?? fallback;
};

const truncate = (value: string): string => (value.length <= DETAIL_LIMIT ? value : `${value.slice(0, DETAIL_LIMIT)}…`);

async function main(): Promise<void> {
  const rootDir = path.resolve(flag("root", process.env[ROOT_DIR_ENV] ?? process.cwd()));
  const mode = parseRestartMode(process.env[RESTART_MODE_ENV]);
  const serverPid = Number(process.env[SERVER_PID_ENV] ?? flag("server-pid", "0"));

  const store = new UpdateStatusStore(path.join(rootDir, "data", "update-status.json"));

  let config: AppConfig;
  try {
    config = loadConfig(rootDir);
  } catch (error) {
    const message = `config error: ${error instanceof Error ? error.message : String(error)}`;
    /* Without a config there is nothing to run, but the run must not stay "running". */
    log(message);
    markRunFailed(store, message);
    process.exitCode = 1;
    return;
  }

  const status = store.read();
  const run = status?.lastRun ?? null;

  if (status === null || run === null || run.status !== "running" || run.targetBranch === null) {
    log("no running update to continue; nothing to do");
    return;
  }

  const targetBranch = run.targetBranch;
  let current: UpdateStatus = status;
  let active: UpdateRun = run;

  const record = (label: string, ok: boolean, detail: string): void => {
    active = { ...active, steps: [...active.steps, { at: Date.now(), label, ok, detail: truncate(detail) }] };
    if (active.steps.length > MAX_STEP_LOG) {
      active = { ...active, steps: active.steps.slice(-MAX_STEP_LOG) };
    }
    current = { ...current, lastRun: active };
    store.write(current);
    log(`${ok ? "ok" : "failed"}: ${label}${detail.length > 0 ? ` — ${truncate(detail)}` : ""}`);
  };

  const fail = (label: string, detail: string): void => {
    record(label, false, detail);
    active = { ...active, status: "failed", finishedAt: Date.now(), message: detail };
    current = { ...current, phase: "failed", canApply: false, message: detail, lastRun: active };
    store.write(current);
    process.exitCode = 1;
  };

  const succeed = async (): Promise<void> => {
    const after = await readGitInfo(rootDir);
    active = {
      ...active,
      status: "done",
      finishedAt: Date.now(),
      toHead: after?.head ?? null,
      toVersion: readAppVersion(rootDir),
      message: null,
    };
    current = { ...current, phase: "restarting", canApply: false, message: null, lastRun: active };
    store.write(current);
    log(`applied '${targetBranch}': v${run.fromVersion} -> v${active.toVersion}`);

    const request: RestartRequest = { mode, rootDir, restartUnit: config.update.restartUnit, serverPid };
    const outcome = await applyRestart(request);
    active = { ...active, message: outcome };
    store.write({ ...current, lastRun: active });
    log(outcome);
  };

  log(`applying '${targetBranch}' (restart mode: ${mode})`);

  const before = await readGitInfo(rootDir);
  if (before === null) {
    fail("git check", "git is unavailable or this checkout is not a git work tree");
    return;
  }

  if (before.branch !== targetBranch) {
    const checkout = await checkoutBranch(rootDir, targetBranch);
    if (!checkout.ok) {
      fail(`git checkout ${targetBranch}`, checkout.error ?? checkout.output);
      return;
    }
    record(`git checkout ${targetBranch}`, true, checkout.output);
  }

  const pull = await pullFastForward(rootDir, config.update.remote, targetBranch);
  if (!pull.ok) {
    fail(`git pull --ff-only ${config.update.remote} ${targetBranch}`, pull.error ?? pull.output);
    return;
  }
  record(`git pull --ff-only ${config.update.remote} ${targetBranch}`, true, pull.output);

  const updated = await readGitInfo(rootDir);
  const newHead = updated?.head ?? null;
  if (run.fromHead !== null && newHead !== null && newHead !== run.fromHead) {
    const files = await changedFiles(rootDir, run.fromHead, newHead);
    const needsInstall = touchesManifests(files);
    record("changed files", true, `${files.length} file(s), dependency install ${needsInstall ? "required" : "not required"}`);

    if (config.update.runInstall && needsInstall) {
      const installed = await runNpm(rootDir, ["install", "--no-audit", "--no-fund"], INSTALL_TIMEOUT_MS);
      if (!installed.ok) {
        fail("npm install", installed.error ?? installed.output);
        return;
      }
      record("npm install", true, installed.output);
    }
  }

  if (config.update.runBuild) {
    const built = await runNpm(rootDir, ["run", "build"], BUILD_TIMEOUT_MS);
    if (!built.ok) {
      fail("npm run build", built.error ?? built.output);
      return;
    }
    record("npm run build", true, built.output);
  }

  await succeed();
}

/** Marks the in-flight run failed in the status file so the panel does not wait for the stale-run timeout. */
function markRunFailed(store: UpdateStatusStore, message: string): void {
  const status = store.read();
  if (status === null || status.lastRun === null) {
    return;
  }
  const failed: UpdateRun = { ...status.lastRun, status: "failed", finishedAt: Date.now(), message };
  store.write({ ...status, phase: "failed", canApply: false, message, lastRun: failed });
}

main().catch((error: unknown) => {
  log(`unhandled failure: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
