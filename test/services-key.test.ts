import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiKeyNotAllowedError } from "../src/services/errors.js";
import { resolveStartApiKey } from "../src/services/model.js";

describe("resolveStartApiKey", () => {
  it("gives a service without a key environment no key", () => {
    assert.equal(resolveStartApiKey("plain", null, null, null), null);
  });

  it("refuses a key for a service that declares no key environment", () => {
    try {
      resolveStartApiKey("plain", null, "a-typed-key", null);
      throw new Error("no error thrown");
    } catch (error) {
      assert.ok(error instanceof ApiKeyNotAllowedError);
      assert.equal((error as ApiKeyNotAllowedError).serviceId, "plain");
    }
  });

  it("prefers the key the browser typed over the remembered one", () => {
    assert.equal(resolveStartApiKey("strata", "STRATA_API_KEY", "typed-key", "remembered-key"), "typed-key");
  });

  it("reuses the key of the last start when the browser types none", () => {
    assert.equal(resolveStartApiKey("strata", "STRATA_API_KEY", null, "remembered-key"), "remembered-key");
  });

  it("answers null when neither the browser nor a past start gave a key", () => {
    assert.equal(resolveStartApiKey("strata", "STRATA_API_KEY", null, null), null);
  });
});