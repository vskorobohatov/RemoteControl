import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { readAppVersion } from "../appVersion.js";
import type { AppConfig } from "../config.js";
import type { EventBus } from "../lib/bus.js";
import { commandExists } from "../lib/run.js";
import { readServiceLog } from "../services/logs.js";
import type { LogPage, ReleaseInfo, RestartMode, UpdatePhase, UpdateRun, UpdateStatus } from "../types.js";
import { compareWithRef, fetchRemote, listReleaseRefs, readGitInfo } from "./git.js";
import {
  RESTART_MODE_ENV,
  resolveRestartMode,
  ROOT_DIR_ENV,
  runnerInvocation,
  RUNNER_UNIT,
  SERVER_PID_ENV,
} from "./restart.js";
import { compileReleasePattern, updateBlockers, type ReleaseRef } from "./refs.js";
import { compareVersions, parseVersion, type Version } from "./semver.js";
import { UpdateStatusStore } from "./store.js";

const STALE_RUN_MS = 20 * 60_000;
const CHECK_STALE_MS = 5 * 60_000;
const CHECK_NOT_FINISHED = "the last check did not finish; press Check for updates";
const UPDATE_LOG_ID = "update";
const STATUS_FILE = path.join("data", "update-status.json");
const FALLBACK_VERSION: Version = { raw: "0.0.0", major: 0, minor: 0, patch: 0 };

export interface UpdateApplyResult {
  ok: boolean;
  httpStatus: number;
  status: UpdateStatus;
  message: string;
}

export class UpdateService {
  private readonly store: UpdateStatusStore;
  private readonly logPath: string;
  private readonly pattern: RegExp | null;
  private checkInFlight: Promise<UpdateStatus> | null = null;

  public constructor(
    private readonly config: AppConfig,
    private readonly bus: EventBus,
  ) {
    this.store = new UpdateStatusStore(path.join(config.rootDir, STATUS_FILE));
    this.logPath = path.join(config.logDir, "update.log");
    this.pattern = safePattern(config.update.releasePattern);
  }

  public status(): UpdateStatus {
    return withLiveFields(this.store.read() ?? this.emptyStatus(), this.liveFields());
  }

  /**
   * Forgets the recorded state. The panel offers this when what it recorded can no
   * longer be trusted; the next check rebuilds everything from git.
   */
  public reset(): UpdateStatus {
    this.store.clear();
    return this.status();
  }

  public async check(): Promise<UpdateStatus> {
    if (this.checkInFlight !== null) {
      return this.checkInFlight;
    }
    const inFlight = this.runCheck().finally(() => {
      this.checkInFlight = null;
    });
    this.checkInFlight = inFlight;
    return inFlight;
  }

  public async readLog(maxBytes: number): Promise<LogPage> {
    return readServiceLog(UPDATE_LOG_ID, this.logPath, maxBytes);
  }

  public async apply(targetBranch?: string): Promise<UpdateApplyResult> {
    const checked = await this.check();

    if (checked.phase === "applying" || checked.phase === "restarting") {
      return { ok: false, httpStatus: 409, status: checked, message: "an update is already running" };
    }
    if (checked.target === null || !checked.canApply) {
      return {
        ok: false,
        httpStatus: 409,
        status: checked,
        message: checked.message ?? "no update can be applied right now",
      };
    }
    if (targetBranch !== undefined && targetBranch !== checked.target.branch) {
      return {
        ok: false,
        httpStatus: 400,
        status: checked,
        message: `'${targetBranch}' is not the newest available release branch`,
      };
    }

    const invocation = runnerInvocation(this.config.rootDir);
    if (invocation === null) {
      return { ok: false, httpStatus: 500, status: checked, message: "update runner not found; run npm run build first" };
    }

    const run: UpdateRun = {
      startedAt: Date.now(),
      finishedAt: null,
      status: "running",
      targetBranch: checked.target.branch,
      fromVersion: checked.currentVersion,
      toHead: null,
      fromHead: checked.localHead,
      toVersion: null,
      steps: [],
      message: null,
    };
    const started = this.save({ ...checked, phase: "applying", canApply: false, message: null, lastRun: run });
    const mode = resolveRestartMode(this.config.update.restartUnit);

    try {
      await this.spawnRunner(invocation, mode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = this.save({
        ...started,
        phase: "failed",
        message,
        lastRun: { ...run, status: "failed", finishedAt: Date.now(), message },
      });
      return { ok: false, httpStatus: 500, status: failed, message: `failed to start the update runner: ${message}` };
    }

    this.bus.publish(
      "notice",
      { level: "info", message: `self-update to '${checked.target.branch}' started; the server may restart shortly` },
    );
    return { ok: true, httpStatus: 202, status: started, message: `update to '${checked.target.branch}' started` };
  }

  private async runCheck(): Promise<UpdateStatus> {
    const before = this.status();
    const started = this.save({
      ...before,
      checkedAt: Date.now(),
      /* The check is about to compare the release refs against this very version,
         so it is bound to it from the first write - even if the check is interrupted. */
      checkedAgainstVersion: before.currentVersion,
      phase: "checking",
      canApply: false,
      message: null,
    });

    if (!started.enabled) {
      return this.finish(started, "unavailable", false, "self-update is disabled in config.yaml");
    }
    if (this.pattern === null) {
      return this.finish(started, "unavailable", false, "update.release_pattern is not a valid regular expression");
    }

    const gitInfo = await readGitInfo(this.config.rootDir);
    if (gitInfo === null) {
      return this.finish(started, "unavailable", false, "git is unavailable or this checkout is not a git work tree");
    }

    const withGit = {
      ...started,
      branch: gitInfo.branch,
      upstream: gitInfo.upstream,
      localHead: gitInfo.head,
      dirty: gitInfo.dirty,
    };
    const fetched = await fetchRemote(this.config.rootDir, this.config.update.remote, this.config.update.fetchTimeoutMs);
    if (!fetched.ok) {
      return this.finish(withGit, "failed", false, `git fetch failed: ${fetched.error ?? "unknown error"}`);
    }

    const releases = await listReleaseRefs(this.config.rootDir, this.config.update.remote, this.pattern);
    const currentVersion = parseVersion(started.currentVersion) ?? FALLBACK_VERSION;
    const target = releases.find((release) => compareVersions(release.version, currentVersion) > 0) ?? null;
    const withReleases = {
      ...withGit,
      releases: releases.map(toReleaseInfo),
      target: target === null ? null : toReleaseInfo(target),
    };

    if (target === null) {
      return this.finish(
        withReleases,
        "up-to-date",
        false,
        `no release branch newer than v${started.currentVersion} was found on '${this.config.update.remote}'`,
      );
    }

    const comparison = await compareWithRef(this.config.rootDir, target.ref);
    const withComparison = {
      ...withReleases,
      ahead: comparison.ahead,
      behind: comparison.behind,
      incomingCommits: comparison.incomingCommits,
    };

    if (target.branch === gitInfo.branch && comparison.behind === 0) {
      /* Nothing to apply, but commits on top of the target are worth naming: they are
         the reason a later update of this same branch will not be a fast-forward. */
      const aheadNote =
        comparison.ahead > 0 ? `; '${target.branch}' has ${comparison.ahead} local commit(s) on top of it` : "";
      return this.finish(
        withComparison,
        "up-to-date",
        false,
        `'${target.branch}' is already checked out and up to date${aheadNote}`,
      );
    }

    const blockers = updateBlockers({
      branch: gitInfo.branch,
      dirty: gitInfo.dirty,
      allowDirty: this.config.update.allowDirty,
      remoteRef: target.ref,
      remoteHead: comparison.remoteHead,
      targetBranch: target.branch,
      ahead: comparison.ahead,
    });
    if (blockers.length > 0) {
      return this.finish(withComparison, "blocked", false, blockers.join("; "));
    }

    return this.finish(withComparison, "available", true, null);
  }

  private finish(status: UpdateStatus, phase: UpdatePhase, canApply: boolean, message: string | null): UpdateStatus {
    /* Bind the result to the version it was computed against, so a process that
       later reports a different version knows the recorded target is stale. */
    return this.save({ ...status, phase, canApply, message, checkedAgainstVersion: status.currentVersion });
  }

  private save(status: UpdateStatus): UpdateStatus {
    const next = withLiveFields(status, this.liveFields());
    this.store.write(next);
    return next;
  }

  private liveFields(): Pick<UpdateStatus, "enabled" | "currentVersion" | "remote"> {
    return {
      enabled: this.config.update.enabled,
      currentVersion: readAppVersion(this.config.rootDir),
      remote: this.config.update.remote,
    };
  }

  private emptyStatus(): UpdateStatus {
    return {
      enabled: true,
      phase: "unknown",
      checkedAt: null,
      currentVersion: "0.0.0",
      remote: "",
      branch: null,
      upstream: null,
      localHead: null,
      dirty: false,
      ahead: 0,
      behind: 0,
      releases: [],
      target: null,
      incomingCommits: [],
      canApply: false,
      message: null,
      lastRun: null,
      checkedAgainstVersion: null,
    };
  }

  private async spawnRunner(
    invocation: { command: string; args: string[] },
    mode: RestartMode,
  ): Promise<void> {
    mkdirSync(this.config.logDir, { recursive: true });
    const logFd = openSync(this.logPath, "a");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      [RESTART_MODE_ENV]: mode,
      [SERVER_PID_ENV]: String(process.pid),
      [ROOT_DIR_ENV]: this.config.rootDir,
    };
    /* A systemd scope keeps the runner out of the server unit's cgroup so that it
       can restart the very unit that spawned it. */
    const scoped = mode === "systemd-unit" && commandExists("systemd-run");
    const program = scoped ? "systemd-run" : invocation.command;
    const args = scoped
      ? [
          "--user",
          "--scope",
          "--unit",
          RUNNER_UNIT,
          "--collect",
          "--property",
          "KillMode=process",
          "--working-directory",
          this.config.rootDir,
          ...Object.entries(env)
            .filter(([key]) => key.startsWith("RC_UPDATE_"))
            .map(([key, value]) => `--setenv=${key}=${value ?? ""}`),
          invocation.command,
          ...invocation.args,
        ]
      : invocation.args;

    await new Promise<void>((resolve, reject) => {
      const child = spawn(program, args, {
        cwd: this.config.rootDir,
        env,
        stdio: ["ignore", logFd, logFd],
        detached: true,
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        closeSync(logFd);
        resolve();
      });
    });
  }
}

/** Phases that claim work is in progress right now. */
const ACTIVE_PHASES: readonly UpdatePhase[] = ["checking", "applying", "restarting"];

/**
 * The recorded state plus what this process knows right now. The order of the
 * rules matters: each one only runs when the evidence of the one above is absent.
 */
export function withLiveFields(
  status: UpdateStatus,
  live: Pick<UpdateStatus, "enabled" | "currentVersion" | "remote">,
): UpdateStatus {
  const merged = { ...status, ...live };
  const run = merged.lastRun;

  /* A finished run whose target version is now the running version means this
     process was started by that update - but only while no newer release exists,
     otherwise a newer branch could never be applied again. */
  if (
    run !== null &&
    run.status === "done" &&
    run.toVersion !== null &&
    run.toVersion === live.currentVersion &&
    !hasNewerTarget(merged)
  ) {
    return {
      ...merged,
      phase: "up-to-date",
      canApply: false,
      message: `updated to '${run.targetBranch}' (v${run.toVersion})`,
    };
  }

  /* A run that is still reporting is live work and stays exactly as it is. */
  if (run !== null && run.status === "running") {
    const lastActivity = Math.max(run.startedAt, ...run.steps.map((step) => step.at));
    if (Date.now() - lastActivity < STALE_RUN_MS) {
      return merged;
    }
    const message = "the update runner stopped responding";
    return {
      ...merged,
      phase: "failed",
      canApply: false,
      message,
      lastRun: { ...run, status: "failed", finishedAt: Date.now(), message },
    };
  }

  /* Nothing is running, so a phase that still claims work is a leftover: the runner's
     own "restarting" record, or a check whose process died before it could report.
     Left alone it keeps the panel busy forever, because the panel never checks by
     itself - and the button that would have checked is the one that is disabled. */
  if (ACTIVE_PHASES.includes(merged.phase) && !isFreshCheck(merged)) {
    const message =
      merged.phase === "checking" ? CHECK_NOT_FINISHED : "the last recorded update finished; press Check for updates";
    return needsRecheck(merged, message);
  }

  /* A check is only meaningful for the version it compared the releases against.
     A record written before this field existed has no binding to compare, and is
     left alone - the rules above already cover the states such a file can be in. */
  const checkedAgainst = merged.checkedAgainstVersion ?? null;
  if (checkedAgainst !== null && checkedAgainst !== live.currentVersion) {
    return needsRecheck(
      merged,
      `the recorded check was made against v${checkedAgainst}; press Check for updates`,
    );
  }

  return merged;
}

/** A check that started moments ago is still in flight; one from long ago was abandoned. */
function isFreshCheck(status: UpdateStatus): boolean {
  return status.phase === "checking" && status.checkedAt !== null && Date.now() - status.checkedAt <= CHECK_STALE_MS;
}

/** Drops a result that can no longer be trusted so the panel asks for a new check. */
function needsRecheck(status: UpdateStatus, message: string): UpdateStatus {
  return { ...status, phase: "unknown", canApply: false, target: null, message };
}

/** True when the status carries a release branch newer than the running version. */
function hasNewerTarget(status: UpdateStatus): boolean {
  const target = status.target;
  if (target === null) {
    return false;
  }
  const targetVersion = parseVersion(target.version);
  const currentVersion = parseVersion(status.currentVersion);
  if (targetVersion === null || currentVersion === null) {
    return false;
  }
  return compareVersions(targetVersion, currentVersion) > 0;
}

const toReleaseInfo = (release: ReleaseRef): ReleaseInfo => ({
  ref: release.ref,
  branch: release.branch,
  version: release.version.raw,
});

function safePattern(source: string): RegExp | null {
  try {
    return compileReleasePattern(source);
  } catch {
    return null;
  }
}
