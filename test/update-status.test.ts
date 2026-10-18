import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { withLiveFields } from "../src/update/service.js";
import { UpdateStatusStore } from "../src/update/store.js";
import type { UpdateRun, UpdateStatus } from "../src/types.js";

const MINUTE_MS = 60_000;
const LIVE: Pick<UpdateStatus, "enabled" | "currentVersion" | "remote"> = {
  enabled: true,
  currentVersion: "0.1.0",
  remote: "origin",
};

const run = (overrides: Partial<UpdateRun> = {}): UpdateRun => ({
  startedAt: Date.now(),
  finishedAt: null,
  status: "running",
  targetBranch: "release_0.2",
  fromVersion: "0.1.0",
  toVersion: null,
  fromHead: "aaa111",
  toHead: null,
  steps: [],
  message: null,
  ...overrides,
});

const status = (overrides: Partial<UpdateStatus> = {}): UpdateStatus => ({
  enabled: true,
  phase: "applying",
  checkedAt: Date.now(),
  currentVersion: "0.1.0",
  remote: "origin",
  branch: "release_0.1",
  upstream: "origin/release_0.1",
  localHead: "aaa111",
  dirty: false,
  ahead: 0,
  behind: 3,
  releases: [],
  target: { ref: "refs/remotes/origin/release_0.2", branch: "release_0.2", version: "0.2.0" },
  incomingCommits: [],
  canApply: false,
  message: null,
  lastRun: null,
  checkedAgainstVersion: null,
  ...overrides,
});

const tempFile = (): { file: string; cleanup: () => void } => {
  const dir = mkdtempSync(path.join(tmpdir(), "rc-update-store-"));
  return {
    file: path.join(dir, "data", "update-status.json"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
};

describe("withLiveFields", () => {
  it("overlays the version, remote and enabled flag of the running process", () => {
    const merged = withLiveFields(status({ currentVersion: "0.0.0", remote: "old-remote", enabled: false }), LIVE);

    assert.equal(merged.currentVersion, "0.1.0");
    assert.equal(merged.remote, "origin");
    assert.equal(merged.enabled, true);
  });

  it("keeps a running update while the runner reports recently", () => {
    const merged = withLiveFields(status({ lastRun: run() }), LIVE);

    assert.equal(merged.phase, "applying");
    assert.equal(merged.lastRun?.status, "running");
  });

  it("marks a run that stopped reporting as failed", () => {
    const stale = run({
      startedAt: Date.now() - 25 * MINUTE_MS,
      steps: [{ at: Date.now() - 21 * MINUTE_MS, label: "npm run build", ok: true, detail: "" }],
    });
    const merged = withLiveFields(status({ lastRun: stale }), LIVE);

    assert.equal(merged.phase, "failed");
    assert.equal(merged.canApply, false);
    assert.equal(merged.lastRun?.status, "failed");
    assert.equal(merged.lastRun?.finishedAt !== null, true);
    assert.match(merged.message ?? "", /stopped responding/);
  });

  it("reports a finished run whose version is now the running one as up to date", () => {
    const done = run({ status: "done", finishedAt: Date.now(), toVersion: "0.2.0", toHead: "bbb222" });
    const merged = withLiveFields(status({ phase: "restarting", lastRun: done }), { ...LIVE, currentVersion: "0.2.0" });

    assert.equal(merged.phase, "up-to-date");
    assert.equal(merged.canApply, false);
    assert.equal(merged.message, "updated to 'release_0.2' (v0.2.0)");
  });

  it("keeps a newer release branch applicable after an older update finished", () => {
    const done = run({ status: "done", finishedAt: Date.now(), toVersion: "0.2.0", toHead: "bbb222" });
    const merged = withLiveFields(
      status({
        phase: "available",
        canApply: true,
        releases: [
          { ref: "refs/remotes/origin/release_0.3", branch: "release_0.3", version: "0.3.0" },
          { ref: "refs/remotes/origin/release_0.2", branch: "release_0.2", version: "0.2.0" },
        ],
        target: { ref: "refs/remotes/origin/release_0.3", branch: "release_0.3", version: "0.3.0" },
        lastRun: done,
      }),
      { ...LIVE, currentVersion: "0.2.0" },
    );

    assert.equal(merged.phase, "available");
    assert.equal(merged.canApply, true);
    assert.equal(merged.target?.branch, "release_0.3");
    assert.equal(merged.message, null);
    assert.equal(merged.lastRun?.status, "done");
  });

  it("still reports up to date when the finished run's branch is the newest release", () => {
    const done = run({ status: "done", finishedAt: Date.now(), toVersion: "0.2.0", toHead: "bbb222" });
    const merged = withLiveFields(
      status({
        phase: "restarting",
        canApply: true,
        target: { ref: "refs/remotes/origin/release_0.2", branch: "release_0.2", version: "0.2.0" },
        lastRun: done,
      }),
      { ...LIVE, currentVersion: "0.2.0" },
    );

    assert.equal(merged.phase, "up-to-date");
    assert.equal(merged.canApply, false);
    assert.equal(merged.message, "updated to 'release_0.2' (v0.2.0)");
  });

  it("leaves a finished run untouched when the version did not change", () => {
    const failed = run({ status: "failed", finishedAt: Date.now(), message: "npm run build failed" });
    const merged = withLiveFields(
      status({ phase: "failed", message: "npm run build failed", lastRun: failed }),
      { ...LIVE, currentVersion: "0.1.0" },
    );

    assert.equal(merged.phase, "failed");
    assert.equal(merged.message, "npm run build failed");
    assert.equal(merged.lastRun?.status, "failed");
  });

  it("does not leave a finished run claiming the server is still restarting", () => {
    const done = run({ status: "done", finishedAt: Date.now(), toVersion: "0.3.0", toHead: "ccc333" });
    const merged = withLiveFields(
      status({
        phase: "restarting",
        canApply: true,
        checkedAgainstVersion: "0.3.0",
        target: { ref: "refs/remotes/origin/release_0.4", branch: "release_0.4", version: "0.4.0" },
        lastRun: done,
      }),
      { ...LIVE, currentVersion: "0.3.0" },
    );

    assert.equal(merged.phase, "unknown");
    assert.equal(merged.canApply, false);
    assert.equal(merged.target, null);
    assert.match(merged.message ?? "", /press Check for updates/);
  });

  it("invalidates a check recorded against a version that is no longer the running one", () => {
    const merged = withLiveFields(
      status({
        phase: "available",
        canApply: true,
        checkedAt: Date.now() - MINUTE_MS,
        checkedAgainstVersion: "0.2.0",
        target: { ref: "refs/remotes/origin/release_0.3", branch: "release_0.3", version: "0.3.0" },
      }),
      { ...LIVE, currentVersion: "0.3.0" },
    );

    assert.equal(merged.phase, "unknown");
    assert.equal(merged.canApply, false);
    assert.match(merged.message ?? "", /made against v0\.2\.0/);
  });

  it("keeps a check that was made against the running version", () => {
    const merged = withLiveFields(
      status({
        phase: "available",
        canApply: true,
        checkedAgainstVersion: "0.3.0",
        target: { ref: "refs/remotes/origin/release_0.4", branch: "release_0.4", version: "0.4.0" },
      }),
      { ...LIVE, currentVersion: "0.3.0" },
    );

    assert.equal(merged.phase, "available");
    assert.equal(merged.canApply, true);
  });

  it("treats a check that never reported as abandoned instead of in flight", () => {
    const merged = withLiveFields(status({ phase: "checking", checkedAt: Date.now() - 6 * MINUTE_MS }), LIVE);

    assert.equal(merged.phase, "unknown");
    assert.equal(merged.canApply, false);
    assert.match(merged.message ?? "", /did not finish/);
  });

  it("keeps a check that started moments ago marked as in flight", () => {
    const merged = withLiveFields(status({ phase: "checking", checkedAt: Date.now() }), LIVE);

    assert.equal(merged.phase, "checking");
  });
});

describe("UpdateStatusStore", () => {
  it("returns null when no status file exists yet", () => {
    const { file, cleanup } = tempFile();
    try {
      assert.equal(new UpdateStatusStore(file).read(), null);
    } finally {
      cleanup();
    }
  });

  it("writes the status and reads it back without leaving a temporary file", () => {
    const { file, cleanup } = tempFile();
    try {
      const store = new UpdateStatusStore(file);
      const written = status({ lastRun: run() });
      store.write(written);

      assert.deepEqual(store.read(), written);
      assert.equal(JSON.parse(readFileSync(file, "utf8")).phase, "applying");
      assert.deepEqual(readdirSync(path.dirname(file)), ["update-status.json"]);
    } finally {
      cleanup();
    }
  });

  it("ignores a corrupt file instead of throwing", () => {
    const { file, cleanup } = tempFile();
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "{ not json", "utf8");
      assert.equal(new UpdateStatusStore(file).read(), null);
    } finally {
      cleanup();
    }
  });

  it("ignores an object that is not an update status", () => {
    const { file, cleanup } = tempFile();
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ hello: 1 }), "utf8");
      assert.equal(new UpdateStatusStore(file).read(), null);
    } finally {
      cleanup();
    }
  });

  it("clears the recorded status and any temporary file a crashed write left", () => {
    const { file, cleanup } = tempFile();
    try {
      const store = new UpdateStatusStore(file);
      store.write(status({ lastRun: run() }));
      writeFileSync(`${file}.${process.pid}.tmp`, "{}", "utf8");

      store.clear();

      assert.equal(store.read(), null);
      assert.deepEqual(readdirSync(path.dirname(file)), []);
    } finally {
      cleanup();
    }
  });

  it("clearing a status that was never written is not an error", () => {
    const { file, cleanup } = tempFile();
    try {
      new UpdateStatusStore(file).clear();
      assert.equal(new UpdateStatusStore(file).read(), null);
    } finally {
      cleanup();
    }
  });
});
