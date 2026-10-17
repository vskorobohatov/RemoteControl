import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProcStat, usagePercent } from "../src/lib/procfs.js";

const IDLE_SAMPLE = [
  "cpu  100 0 100 800 50 10 5 0 0 0",
  "cpu0 50 0 50 400 25 5 2 0 0 0",
  "cpu1 50 0 50 400 25 5 3 0 0 0",
  "intr 12345",
].join("\n");

describe("parseProcStat", () => {
  it("treats only the idle and iowait columns as non-busy", () => {
    const snapshot = parseProcStat(IDLE_SAMPLE);

    assert.equal(snapshot.aggregate.total, 1065);
    assert.equal(snapshot.aggregate.busy, 215);
  });

  it("splits per-core samples from the aggregate line", () => {
    const snapshot = parseProcStat(IDLE_SAMPLE);

    assert.equal(snapshot.perCore.length, 2);
    assert.deepEqual(snapshot.perCore.map((core) => core.total), [532, 533]);
    assert.deepEqual(snapshot.perCore.map((core) => core.busy), [107, 108]);
  });
});

describe("usagePercent", () => {
  it("reports zero when no additional time was spent busy", () => {
    assert.equal(usagePercent({ busy: 100, total: 1000 }, { busy: 100, total: 2000 }), 0);
  });

  it("reports the busy share of the elapsed time", () => {
    assert.equal(usagePercent({ busy: 100, total: 1000 }, { busy: 600, total: 2000 }), 50);
    assert.equal(usagePercent({ busy: 100, total: 1000 }, { busy: 1100, total: 2000 }), 100);
  });

  it("clamps to zero when the counters did not advance", () => {
    assert.equal(usagePercent({ busy: 100, total: 1000 }, { busy: 100, total: 1000 }), 0);
  });
});

describe("cpu utilisation from consecutive /proc/stat samples", () => {
  it("stays near zero for an idle machine that accumulates iowait and irq", () => {
    const before = parseProcStat(IDLE_SAMPLE);
    const after = parseProcStat(
      [
        "cpu  104 0 106 3800 90 40 8 0 0 0",
        "cpu0 52 0 53 1900 45 20 4 0 0 0",
        "cpu1 52 0 53 1900 45 20 4 0 0 0",
      ].join("\n"),
    );

    assert.ok(usagePercent(before.aggregate, after.aggregate) < 5);
  });

  it("approaches full load when the idle column stops advancing", () => {
    const before = parseProcStat(IDLE_SAMPLE);
    const after = parseProcStat(
      [
        "cpu  600 0 500 810 55 12 6 0 0 0",
        "cpu0 300 0 250 405 27 6 3 0 0 0",
        "cpu1 300 0 250 405 28 6 3 0 0 0",
      ].join("\n"),
    );

    assert.ok(usagePercent(before.aggregate, after.aggregate) > 90);
  });
});
