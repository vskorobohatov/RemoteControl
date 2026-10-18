import type { IncomingCommit } from "../types.js";
import { parseVersion, compareVersions, type Version } from "./semver.js";

export const FIELD_SEPARATOR = "\u001f";
export const RECORD_SEPARATOR = "\u001e";

export const COMMIT_LOG_FORMAT = ["%h", "%an", "%aI", "%s"].join(FIELD_SEPARATOR) + RECORD_SEPARATOR;
export const MAX_INCOMING_COMMITS = 15;
export const MAX_STEP_LOG = 24;

const PACKAGE_MANIFESTS = new Set(["package.json", "package-lock.json", "npm-shrink.json"]);

export interface ReleaseRef {
  ref: string;
  branch: string;
  version: Version;
}

export function compileReleasePattern(source: string): RegExp {
  const pattern = new RegExp(source);
  if (pattern.source === source && !pattern.flags.includes("g")) {
    return pattern;
  }
  return new RegExp(source, pattern.flags.replace("g", ""));
}

/** Reads `git for-each-ref --format=%(refname)` output and keeps refs whose branch name matches the pattern. */
export function parseReleaseRefs(stdout: string, refPrefix: string, pattern: RegExp): ReleaseRef[] {
  const found = new Map<string, ReleaseRef>();

  for (const line of stdout.split("\n")) {
    const ref = line.trim();
    if (!ref.startsWith(refPrefix)) {
      continue;
    }
    const branch = ref.slice(refPrefix.length);
    if (branch.length === 0 || branch.includes("/")) {
      continue;
    }
    const captured = branch.match(pattern)?.[1];
    if (captured === undefined) {
      continue;
    }
    const version = parseVersion(captured);
    if (version === null) {
      continue;
    }
    const existing = found.get(formatKey(version));
    if (existing === undefined || compareVersions(version, existing.version) > 0) {
      found.set(formatKey(version), { ref, branch, version });
    }
  }

  return [...found.values()].sort((a, b) => compareVersions(b.version, a.version) || a.branch.localeCompare(b.branch));
}

const formatKey = (version: Version): string =>
  `${version.major}.${version.minor}.${version.patch}`;

/** Any non-empty porcelain output means the working tree has uncommitted changes. */
export function parsePorcelainStatus(text: string): boolean {
  return text.split("\n").some((line) => line.trim() !== "");
}

/** `git rev-list --left-right --count HEAD...ref` prints "<ahead>\t<behind>". */
export function parseAheadBehind(text: string): { ahead: number; behind: number } {
  const match = text.trim().match(/^(\d+)\s+(\d+)$/);
  if (match === null) {
    return { ahead: 0, behind: 0 };
  }
  return { ahead: Number(match[1]), behind: Number(match[2]) };
}

export function parseUpstream(text: string): string | null {
  const value = text.trim();
  return value === "" || value === "@" ? null : value;
}

export function parseCommitLog(text: string): IncomingCommit[] {
  return text
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.trim() !== "")
    .slice(0, MAX_INCOMING_COMMITS)
    .map((record) => {
      const [shortHash, author, date, ...rest] = record.split(FIELD_SEPARATOR);
      return {
        shortHash: shortHash ?? "",
        author: author ?? "",
        date: date ?? "",
        subject: rest.join(FIELD_SEPARATOR),
      };
    })
    .filter((commit) => commit.shortHash !== "");
}

export function parseNameList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function touchesManifests(paths: string[]): boolean {
  return paths.some((raw) => {
    const file = raw.replaceAll("\\", "/");
    return PACKAGE_MANIFESTS.has(file) || file.startsWith("node_modules/");
  });
}

export interface UpdateBlockersInput {
  branch: string | null;
  dirty: boolean;
  allowDirty: boolean;
  remoteRef: string;
  remoteHead: string | null;
  targetBranch: string;
  ahead: number;
}

/**
 * Why the runner must not be started. An empty list means the update is a clean
 * fast-forward of this checkout to the target ref, which is the only kind of
 * update the runner performs: `git checkout <target>` and `git pull --ff-only`.
 *
 * A checkout with commits the target does not contain is not such an update. It
 * would either stop the pull with "Not possible to fast-forward" after the run
 * already began, or - when the target is another branch - leave those commits
 * behind without saying so. Both are reported here instead.
 */
export function updateBlockers(input: UpdateBlockersInput): string[] {
  const blockers: string[] = [];
  if (input.remoteHead === null) {
    blockers.push(`'${input.remoteRef}' is not reachable`);
  }
  if (input.branch === null) {
    blockers.push("HEAD is detached; check out a branch first");
  }
  if (input.dirty && !input.allowDirty) {
    blockers.push("the working tree has uncommitted changes");
  }
  if (input.ahead > 0) {
    blockers.push(
      `'${input.branch ?? "HEAD"}' has ${input.ahead} local commit(s) that '${input.targetBranch}' does not contain; merge or rebase them first`,
    );
  }
  return blockers;
}

