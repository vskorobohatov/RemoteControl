import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { runCommand, type CommandResult } from "../src/lib/run.js";
import {
  changedFiles,
  checkoutBranch,
  compareWithRef,
  listReleaseRefs,
  pullFastForward,
  readGitInfo,
} from "../src/update/git.js";

const GIT_TIMEOUT_MS = 20_000;
const RELEASE_PATTERN = /^release_(\d+\.\d+(?:\.\d+)?)$/;

const git = (cwd: string, ...args: string[]): Promise<CommandResult> =>
  runCommand("git", ["-C", cwd, ...args], GIT_TIMEOUT_MS);

async function expectOk(result: CommandResult, label: string): Promise<void> {
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  }
}

describe("git helpers against a throwaway repository", () => {
  let workspace = "";
  let remoteDir = "";
  let workDir = "";
  let mainHead = "";
  let releaseHead = "";

  before(async () => {
    workspace = mkdtempSync(path.join(os.tmpdir(), "rc-update-"));
    remoteDir = path.join(workspace, "remote.git");
    workDir = path.join(workspace, "work");
    mkdirSync(workDir);

    await expectOk(await runCommand("git", ["init", "--bare", "--initial-branch=main", remoteDir], GIT_TIMEOUT_MS), "init bare");
    await expectOk(await git(workDir, "init", "--initial-branch=main"), "init work tree");
    await expectOk(await git(workDir, "config", "user.email", "test@example.com"), "set email");
    await expectOk(await git(workDir, "config", "user.name", "Test User"), "set name");
    await expectOk(await git(workDir, "remote", "add", "origin", remoteDir), "add remote");

    writeFileSync(path.join(workDir, "README.md"), "v0.1\n");
    await expectOk(await git(workDir, "add", "README.md"), "stage readme");
    await expectOk(await git(workDir, "commit", "-m", "initial"), "commit initial");
    await expectOk(await git(workDir, "push", "-u", "origin", "main"), "push main");

    await expectOk(await git(workDir, "checkout", "-b", "release_0.2"), "create release branch");
    writeFileSync(path.join(workDir, "README.md"), "v0.2\n");
    await expectOk(await git(workDir, "commit", "-am", "release 0.2"), "commit release");
    await expectOk(await git(workDir, "push", "origin", "release_0.2"), "push release branch");

    /* Drop the local branch so the checkout has to recreate it from the remote. */
    await expectOk(await git(workDir, "checkout", "main"), "return to main");
    await expectOk(await git(workDir, "branch", "-D", "release_0.2"), "drop local release branch");

    mainHead = (await git(workDir, "rev-parse", "HEAD")).stdout.trim();
    releaseHead = (await git(workDir, "rev-parse", "refs/remotes/origin/release_0.2")).stdout.trim();
  });

  after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("reads the current branch, upstream and cleanliness", async () => {
    const info = await readGitInfo(workDir);

    assert.ok(info !== null);
    assert.equal(info.branch, "main");
    assert.equal(info.upstream, "origin/main");
    assert.equal(info.head, mainHead);
    assert.equal(info.dirty, false);
  });

  it("lists only release refs from the configured remote", async () => {
    const releases = await listReleaseRefs(workDir, "origin", RELEASE_PATTERN);

    assert.deepEqual(
      releases.map((release) => ({ branch: release.branch, version: release.version.raw })),
      [{ branch: "release_0.2", version: "0.2" }],
    );
  });

  it("counts the commits a release branch is ahead and lists them", async () => {
    const comparison = await compareWithRef(workDir, "refs/remotes/origin/release_0.2");

    assert.equal(comparison.remoteHead, releaseHead);
    assert.deepEqual({ ahead: comparison.ahead, behind: comparison.behind }, { ahead: 0, behind: 1 });
    assert.deepEqual(
      comparison.incomingCommits.map((commit) => commit.subject),
      ["release 0.2"],
    );
  });

  it("reports the files a release branch changes", async () => {
    assert.deepEqual(await changedFiles(workDir, mainHead, releaseHead), ["README.md"]);
  });

  it("checks out a remote-only branch and fast-forwards it", async () => {
    const checkout = await checkoutBranch(workDir, "release_0.2");
    assert.ok(checkout.ok, checkout.error ?? "");

    const pull = await pullFastForward(workDir, "origin", "release_0.2");
    assert.ok(pull.ok, pull.error ?? "");

    const info = await readGitInfo(workDir);
    assert.ok(info !== null);
    assert.equal(info.branch, "release_0.2");
    assert.equal(info.head, releaseHead);

    const comparison = await compareWithRef(workDir, "refs/remotes/origin/release_0.2");
    assert.deepEqual({ ahead: comparison.ahead, behind: comparison.behind }, { ahead: 0, behind: 0 });
  });

  it("refuses to fast-forward a release branch that diverged from its remote", async () => {
    /* A commit made on the host plus a different commit pushed to the same branch -
       the state a self-update would be started into, and the reason it must not be. */
    await expectOk(await git(workDir, "commit", "-q", "--allow-empty", "-m", "local hotfix"), "commit on the release branch");
    await expectOk(await git(workDir, "checkout", "-q", "-b", "hotfix", "refs/remotes/origin/release_0.2"), "branch from the remote tip");
    await expectOk(await git(workDir, "commit", "-q", "--allow-empty", "-m", "pushed hotfix"), "commit on that branch");
    await expectOk(await git(workDir, "push", "-q", "origin", "hotfix:release_0.2"), "push it onto the release branch");
    await expectOk(await git(workDir, "checkout", "-q", "release_0.2"), "back to the local release branch");
    await expectOk(await git(workDir, "fetch", "-q", "origin"), "fetch");

    const comparison = await compareWithRef(workDir, "refs/remotes/origin/release_0.2");
    assert.deepEqual({ ahead: comparison.ahead, behind: comparison.behind }, { ahead: 1, behind: 1 });

    const pull = await pullFastForward(workDir, "origin", "release_0.2");
    assert.equal(pull.ok, false);
    assert.match(pull.error ?? "", /fast-forward/);
  });

  it("reports a dirty working tree", async () => {
    writeFileSync(path.join(workDir, "scratch.txt"), "uncommitted\n");

    const info = await readGitInfo(workDir);
    assert.ok(info !== null);
    assert.equal(info.dirty, true);
  });

  it("returns null when the directory is not a git work tree", async () => {
    assert.equal(await readGitInfo(workspace), null);
  });
});
