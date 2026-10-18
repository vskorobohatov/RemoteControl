import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FIELD_SEPARATOR,
  RECORD_SEPARATOR,
  parseAheadBehind,
  parseCommitLog,
  parseNameList,
  parsePorcelainStatus,
  parseReleaseRefs,
  parseUpstream,
  touchesManifests,
  updateBlockers,
} from "../src/update/refs.js";

const PATTERN = /^release_(\d+\.\d+(?:\.\d+)?)$/;
const PREFIX = "refs/remotes/origin/";

const refOutput = [
  "refs/remotes/origin/HEAD",
  "refs/remotes/origin/main",
  "refs/remotes/origin/release_0.1",
  "refs/remotes/origin/release_0.10",
  "refs/remotes/origin/release_0.2",
  "refs/remotes/origin/release_0.2/hotfix",
  "refs/remotes/origin/release_notes",
  "refs/remotes/upstream/release_0.3",
];

describe("parseReleaseRefs", () => {
  it("keeps matching refs from the requested remote only, newest first", () => {
    const releases = parseReleaseRefs(refOutput.join("\n"), PREFIX, PATTERN);

    assert.deepEqual(
      releases.map((release) => release.branch),
      ["release_0.10", "release_0.2", "release_0.1"],
    );
    assert.equal(releases[0]?.ref, "refs/remotes/origin/release_0.10");
  });

  it("returns an empty list when nothing matches", () => {
    assert.deepEqual(parseReleaseRefs("refs/remotes/origin/main\n", PREFIX, PATTERN), []);
  });
});

describe("parsePorcelainStatus", () => {
  it("reports a clean tree for empty output", () => {
    assert.equal(parsePorcelainStatus("\n"), false);
  });

  it("reports a dirty tree for any entry", () => {
    assert.equal(parsePorcelainStatus(" M src/index.ts\n"), true);
    assert.equal(parsePorcelainStatus("?? data/update-status.json\n"), true);
  });
});

describe("parseAheadBehind", () => {
  it("reads the left/right counts", () => {
    assert.deepEqual(parseAheadBehind("3\t1\n"), { ahead: 3, behind: 1 });
  });

  it("falls back to zero for unexpected output", () => {
    assert.deepEqual(parseAheadBehind(""), { ahead: 0, behind: 0 });
  });
});

describe("parseUpstream", () => {
  it("returns null when the branch has no upstream", () => {
    assert.equal(parseUpstream("@\n"), null);
    assert.equal(parseUpstream("\n"), null);
  });

  it("returns the upstream name", () => {
    assert.equal(parseUpstream("origin/main\n"), "origin/main");
  });
});

describe("parseCommitLog", () => {
  const record = (hash: string, author: string, date: string, subject: string): string =>
    [hash, author, date, subject].join(FIELD_SEPARATOR) + RECORD_SEPARATOR;

  it("splits records into commits", () => {
    const text = `${record("a1b2c3d", "Snail", "2026-10-18T10:00:00+02:00", "release: bump to 0.2")}${record("e4f5g6h", "Snail", "2026-10-17T09:00:00+02:00", "fix: handle empty log")}`;
    const commits = parseCommitLog(`\n${text}`);

    assert.equal(commits.length, 2);
    assert.deepEqual(commits[0], {
      shortHash: "a1b2c3d",
      author: "Snail",
      date: "2026-10-18T10:00:00+02:00",
      subject: "release: bump to 0.2",
    });
  });

  it("keeps subjects that contain the field separator and stops at the limit", () => {
    const many = Array.from({ length: 40 }, (_, index) => record(`h${index}`, "a", "d", `subject ${index}`));
    const commits = parseCommitLog(many.join(RECORD_SEPARATOR));

    assert.equal(commits.length, 15);
    assert.equal(commits[0]?.subject, "subject 0");
  });

  it("ignores empty records", () => {
    assert.deepEqual(parseCommitLog(`${RECORD_SEPARATOR}${RECORD_SEPARATOR}`), []);
  });
});

describe("parseNameList", () => {
  it("trims and drops blank lines", () => {
    assert.deepEqual(parseNameList(" src/index.ts\n\npackage.json\n"), ["src/index.ts", "package.json"]);
  });
});

describe("touchesManifests", () => {
  it("detects dependency manifest changes", () => {
    assert.equal(touchesManifests(["src/index.ts", "package-lock.json"]), true);
    assert.equal(touchesManifests(["web/src/App.tsx"]), false);
  });
});

describe("updateBlockers", () => {
  /* A checkout that is exactly the history the target branch continues. */
  const fastForward = {
    branch: "release_0.1",
    dirty: false,
    allowDirty: false,
    remoteRef: "refs/remotes/origin/release_0.2",
    remoteHead: "0f2c1d9",
    targetBranch: "release_0.2",
    ahead: 0,
  };

  it("reports nothing when the checkout fast-forwards to the target", () => {
    assert.deepEqual(updateBlockers(fastForward), []);
  });

  it("blocks a checkout that has commits the target does not contain", () => {
    assert.deepEqual(updateBlockers({ ...fastForward, ahead: 2 }), [
      "'release_0.1' has 2 local commit(s) that 'release_0.2' does not contain; merge or rebase them first",
    ]);
  });

  it("names HEAD instead of null when it is detached", () => {
    assert.deepEqual(updateBlockers({ ...fastForward, branch: null, ahead: 1 }), [
      "HEAD is detached; check out a branch first",
      "'HEAD' has 1 local commit(s) that 'release_0.2' does not contain; merge or rebase them first",
    ]);
  });

  it("keeps allow_dirty as the escape hatch for uncommitted changes", () => {
    assert.deepEqual(updateBlockers({ ...fastForward, dirty: true }), ["the working tree has uncommitted changes"]);
    assert.deepEqual(updateBlockers({ ...fastForward, dirty: true, allowDirty: true }), []);
  });

  it("reports a target ref that cannot be resolved", () => {
    assert.deepEqual(updateBlockers({ ...fastForward, remoteHead: null }), [
      "'refs/remotes/origin/release_0.2' is not reachable",
    ]);
  });

  it("reports every blocker at once", () => {
    assert.deepEqual(updateBlockers({ ...fastForward, branch: null, dirty: true, remoteHead: null, ahead: 3 }), [
      "'refs/remotes/origin/release_0.2' is not reachable",
      "HEAD is detached; check out a branch first",
      "the working tree has uncommitted changes",
      "'HEAD' has 3 local commit(s) that 'release_0.2' does not contain; merge or rebase them first",
    ]);
  });
});
