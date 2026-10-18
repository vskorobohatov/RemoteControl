import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareVersions, formatVersion, parseVersion } from "../src/update/semver.js";

describe("parseVersion", () => {
  it("defaults the missing patch to zero", () => {
    assert.deepEqual(parseVersion("0.2"), { raw: "0.2", major: 0, minor: 2, patch: 0 });
  });

  it("parses a full version and tolerates a leading v", () => {
    assert.deepEqual(parseVersion(" v1.4.7 "), { raw: "v1.4.7", major: 1, minor: 4, patch: 7 });
  });

  it("rejects anything that is not a dotted number", () => {
    assert.equal(parseVersion("release_0.2"), null);
    assert.equal(parseVersion("0.2-beta"), null);
    assert.equal(parseVersion(""), null);
  });
});

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    const versions = ["0.1.0", "0.2.0", "0.10.0", "1.0.0"].map((value) => parseVersion(value));
    assert.ok(versions.every((value) => value !== null));

    assert.equal(compareVersions(versions[0]!, versions[1]!), -1);
    assert.equal(compareVersions(versions[1]!, versions[2]!), -1);
    assert.equal(compareVersions(versions[2]!, versions[3]!), -1);
    assert.equal(compareVersions(versions[3]!, versions[0]!), 1);
  });

  it("treats a missing patch as equal to zero", () => {
    assert.equal(compareVersions(parseVersion("1.2")!, parseVersion("1.2.0")!), 0);
  });

  it("sorts release branches numerically instead of lexically", () => {
    const sorted = ["release_0.1", "release_0.10", "release_0.2"]
      .map((branch) => parseVersion(branch.slice(8))!)
      .sort((a, b) => compareVersions(b, a))
      .map(formatVersion);

    assert.deepEqual(sorted, ["0.10.0", "0.2.0", "0.1.0"]);
  });
});
