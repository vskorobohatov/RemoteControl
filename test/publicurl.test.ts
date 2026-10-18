import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serviceAccessLink } from "../src/lib/publicurl.js";

describe("serviceAccessLink", () => {
  it("appends the service id to the origin of the public url", () => {
    assert.equal(
      serviceAccessLink("https://snaildog.scalan.com", "strata"),
      "https://snaildog.scalan.com/strata",
    );
  });

  it("keeps the port of a LAN address", () => {
    assert.equal(serviceAccessLink("http://192.168.1.20:8080", "llama"), "http://192.168.1.20:8080/llama");
  });

  it("drops a trailing slash and any dashboard path from the public url", () => {
    assert.equal(serviceAccessLink("https://snaildog.scalan.com/", "strata"), "https://snaildog.scalan.com/strata");
    assert.equal(
      serviceAccessLink("https://snaildog.scalan.com/dashboard", "strata"),
      "https://snaildog.scalan.com/strata",
    );
  });

  it("ignores surrounding whitespace", () => {
    assert.equal(serviceAccessLink("  https://example.com  ", "my-service"), "https://example.com/my-service");
  });

  it("returns null when no public url is configured", () => {
    assert.equal(serviceAccessLink(null, "strata"), null);
    assert.equal(serviceAccessLink("", "strata"), null);
    assert.equal(serviceAccessLink("   ", "strata"), null);
  });

  it("returns null for values that are not a usable http origin", () => {
    assert.equal(serviceAccessLink("not a url", "strata"), null);
    assert.equal(serviceAccessLink("snaildog.scalan.com", "strata"), null);
    assert.equal(serviceAccessLink("file:///srv/remotecontrol", "strata"), null);
  });
});
