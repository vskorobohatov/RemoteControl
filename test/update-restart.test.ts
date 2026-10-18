import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { applyRestart, parseRestartMode, resolveRestartMode, runnerInvocation } from "../src/update/restart.js";

/** resolveRestartMode looks at how this process was started, so each case needs its own argv. */
function withArgv(argv: string[], body: () => void): void {
  const original = process.argv;
  process.argv = argv;
  try {
    body();
  } finally {
    process.argv = original;
  }
}

const builtServer = ["/usr/bin/node", "/srv/remotecontrol/dist/server/index.js"];
const watchedServer = ["/usr/bin/node", "/srv/remotecontrol/node_modules/.bin/tsx", "watch", "src/index.ts"];

describe("resolveRestartMode", () => {
  it("prefers the configured systemd unit over anything else", () => {
    withArgv(builtServer, () => {
      assert.equal(resolveRestartMode("remotecontrol.service"), "systemd-unit");
    });
    withArgv(watchedServer, () => {
      assert.equal(resolveRestartMode("remotecontrol.service"), "systemd-unit");
    });
  });

  it("relaunches a server that was started as a plain node process", () => {
    withArgv(builtServer, () => {
      assert.equal(resolveRestartMode(null), "relaunch");
      assert.equal(resolveRestartMode(""), "relaunch");
    });
  });

  it("leaves the restart to a watcher session instead of competing with it", () => {
    withArgv(watchedServer, () => {
      assert.equal(resolveRestartMode(null), "none");
    });
    withArgv(["/usr/bin/node", "/srv/remotecontrol/src/index.ts"], () => {
      assert.equal(resolveRestartMode(null), "none");
    });
  });
});

describe("parseRestartMode", () => {
  it("accepts only the modes the runner knows", () => {
    assert.equal(parseRestartMode("systemd-unit"), "systemd-unit");
    assert.equal(parseRestartMode("none"), "none");
    assert.equal(parseRestartMode(undefined), "relaunch");
    assert.equal(parseRestartMode(""), "relaunch");
    assert.equal(parseRestartMode("whatever"), "relaunch");
  });
});

describe("runnerInvocation", () => {
  it("uses the compiled runner when the build output exists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rc-update-runner-"));
    try {
      mkdirSync(path.join(dir, "dist", "server", "update"), { recursive: true });
      writeFileSync(path.join(dir, "dist", "server", "update", "runner.js"), "// compiled\n", "utf8");

      const invocation = runnerInvocation(dir);
      assert.ok(invocation !== null);
      assert.equal(invocation.command, process.execPath);
      assert.deepEqual(invocation.args, [path.join(dir, "dist", "server", "update", "runner.js")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to tsx with the TypeScript source while developing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rc-update-runner-"));
    try {
      mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
      mkdirSync(path.join(dir, "src", "update"), { recursive: true });
      writeFileSync(path.join(dir, "node_modules", ".bin", "tsx"), "#!/bin/sh\n", "utf8");
      writeFileSync(path.join(dir, "src", "update", "runner.ts"), "export {};\n", "utf8");

      const invocation = runnerInvocation(dir);
      assert.ok(invocation !== null);
      assert.equal(invocation.command, path.join(dir, "node_modules", ".bin", "tsx"));
      assert.deepEqual(invocation.args, [path.join(dir, "src", "update", "runner.ts")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when neither runner is present", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rc-update-runner-"));
    try {
      assert.equal(runnerInvocation(dir), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("applyRestart", () => {
  it("does nothing when a watcher owns the restart", async () => {
    const outcome = await applyRestart({
      mode: "none",
      rootDir: "/nonexistent",
      restartUnit: null,
      serverPid: 0,
    });

    assert.match(outcome, /supervisor/);
  });

  it("refuses to restart a unit that was never configured", async () => {
    const outcome = await applyRestart({
      mode: "systemd-unit",
      rootDir: "/nonexistent",
      restartUnit: null,
      serverPid: 0,
    });

    assert.match(outcome, /no update\.restart_unit configured/);
  });
});
