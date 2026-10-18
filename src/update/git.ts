import { runCommand } from "../lib/run.js";
import type { IncomingCommit } from "../types.js";
import {
  COMMIT_LOG_FORMAT,
  MAX_INCOMING_COMMITS,
  parseAheadBehind,
  parseCommitLog,
  parseNameList,
  parsePorcelainStatus,
  parseReleaseRefs,
  parseUpstream,
  type ReleaseRef,
} from "./refs.js";

const QUICK_MS = 8_000;
const PULL_MS = 120_000;

export interface GitInfo {
  branch: string | null;
  upstream: string | null;
  head: string | null;
  dirty: boolean;
}

export interface Comparison {
  remoteHead: string | null;
  ahead: number;
  behind: number;
  incomingCommits: IncomingCommit[];
}

export interface StepResult {
  ok: boolean;
  error: string | null;
  output: string;
}

const git = (rootDir: string, args: string[], timeoutMs: number) =>
  runCommand("git", ["-C", rootDir, ...args], timeoutMs);

const describeFailure = (result: { code: number; stdout: string; stderr: string }, fallback: string): string =>
  (result.stderr || result.stdout).trim() || `${fallback} exited with code ${result.code}`;

const toStepResult = (
  result: { code: number; stdout: string; stderr: string },
  fallback: string,
): StepResult => ({
  ok: result.code === 0,
  error: result.code === 0 ? null : describeFailure(result, fallback),
  output: `${result.stdout}\n${result.stderr}`.trim(),
});

const asStepResult = (error: unknown, fallback: string): StepResult => ({
  ok: false,
  error: error instanceof Error ? error.message : `${fallback}: ${String(error)}`,
  output: "",
});

/** Null when git is unavailable or the root directory is not a git work tree. */
export async function readGitInfo(rootDir: string): Promise<GitInfo | null> {
  let inside: { code: number; stdout: string };
  try {
    inside = await git(rootDir, ["rev-parse", "--is-inside-work-tree"], QUICK_MS);
  } catch {
    return null;
  }
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    return null;
  }

  const [branch, upstream, head, status] = await Promise.all([
    git(rootDir, ["rev-parse", "--abbrev-ref", "HEAD"], QUICK_MS),
    git(rootDir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], QUICK_MS),
    git(rootDir, ["rev-parse", "HEAD"], QUICK_MS),
    git(rootDir, ["status", "--porcelain=v1"], QUICK_MS),
  ]);

  const branchName = branch.stdout.trim();
  return {
    branch: branchName === "" || branchName === "HEAD" ? null : branchName,
    upstream: parseUpstream(upstream.stdout),
    head: head.stdout.trim() || null,
    dirty: parsePorcelainStatus(status.stdout),
  };
}

export async function fetchRemote(
  rootDir: string,
  remote: string,
  timeoutMs: number,
): Promise<StepResult> {
  try {
    return toStepResult(
      await git(rootDir, ["fetch", "--prune", remote], timeoutMs),
      `git fetch ${remote}`,
    );
  } catch (error) {
    return asStepResult(error, `git fetch ${remote}`);
  }
}

export async function listReleaseRefs(
  rootDir: string,
  remote: string,
  pattern: RegExp,
): Promise<ReleaseRef[]> {
  const refPrefix = `refs/remotes/${remote}/`;
  try {
    const result = await git(rootDir, ["for-each-ref", "--format=%(refname)", refPrefix], QUICK_MS);
    return result.code === 0 ? parseReleaseRefs(result.stdout, refPrefix, pattern) : [];
  } catch {
    return [];
  }
}

export async function compareWithRef(rootDir: string, ref: string): Promise<Comparison> {
  const remote = await git(rootDir, ["rev-parse", ref], QUICK_MS);
  if (remote.code !== 0) {
    return { remoteHead: null, ahead: 0, behind: 0, incomingCommits: [] };
  }

  const counts = await git(rootDir, ["rev-list", "--left-right", "--count", `HEAD...${ref}`], QUICK_MS);
  const { ahead, behind } = counts.code === 0 ? parseAheadBehind(counts.stdout) : { ahead: 0, behind: 0 };

  const log = await git(
    rootDir,
    ["log", "--max-count", String(MAX_INCOMING_COMMITS), `--format=${COMMIT_LOG_FORMAT}`, ref, "--not", "HEAD"],
    QUICK_MS,
  );

  return {
    remoteHead: remote.stdout.trim() || null,
    ahead,
    behind,
    incomingCommits: log.code === 0 ? parseCommitLog(log.stdout) : [],
  };
}

export async function checkoutBranch(rootDir: string, branch: string): Promise<StepResult> {
  try {
    return toStepResult(await git(rootDir, ["checkout", branch], PULL_MS), "git checkout");
  } catch (error) {
    return asStepResult(error, "git checkout");
  }
}

export async function pullFastForward(
  rootDir: string,
  remote: string,
  branch: string,
): Promise<StepResult> {
  try {
    return toStepResult(
      await git(rootDir, ["pull", "--ff-only", remote, branch], PULL_MS),
      "git pull",
    );
  } catch (error) {
    return asStepResult(error, "git pull");
  }
}

export async function changedFiles(rootDir: string, fromHead: string, toHead: string): Promise<string[]> {
  try {
    const result = await git(rootDir, ["diff", "--name-only", `${fromHead}..${toHead}`], QUICK_MS);
    return result.code === 0 ? parseNameList(result.stdout) : [];
  } catch {
    return [];
  }
}

export async function runNpm(
  rootDir: string,
  args: string[],
  timeoutMs: number,
): Promise<StepResult> {
  try {
    const result = await runCommand("npm", args, timeoutMs, rootDir);
    return toStepResult(result, `npm ${args.join(" ")}`);
  } catch (error) {
    return asStepResult(error, `npm ${args.join(" ")}`);
  }
}
