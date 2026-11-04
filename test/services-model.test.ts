import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnknownModelChoiceError } from "../src/services/errors.js";
import { resolveStartArgs } from "../src/services/model.js";
import type { ServiceModelConfig, ServiceStartConfig } from "../src/services/types.js";

const start: ServiceStartConfig = {
  command: "setup.sh",
  args: ["--api-key", "secret", "--port", "8092"],
  env: {},
};

const model: ServiceModelConfig = {
  default: "qwen-iq3",
  options: [
    { value: "coder-iq1", label: "coder IQ1_M", args: ["--family", "coder", "--model", "IQ1_M"] },
    {
      value: "qwen-iq3",
      label: "qwen IQ3_XXS",
      args: ["--family", "qwen", "--model", "IQ3_XXS", "--yes"],
    },
  ],
};

describe("resolveStartArgs", () => {
  it("leaves the argv of a service without a model selector untouched", () => {
    const resolved = resolveStartArgs("plain", start, undefined, null, null);
    assert.equal(resolved.model, null);
    assert.equal(resolved.args.join(" "), start.args.join(" "));
  });

  it("ignores a model for a service that has no selector", () => {
    const resolved = resolveStartArgs("plain", start, undefined, "coder-iq1", null);
    assert.equal(resolved.model, null);
    assert.equal(resolved.args.join(" "), start.args.join(" "));
  });

  it("falls back to the configured default when nothing was asked or started before", () => {
    const resolved = resolveStartArgs("strata", start, model, null, null);
    assert.equal(resolved.model, "qwen-iq3");
    assert.equal(resolved.args.at(-1), "--yes");
  });

  it("reuses the model of the last start when the browser does not choose one", () => {
    const resolved = resolveStartArgs("strata", start, model, null, "coder-iq1");
    assert.equal(resolved.model, "coder-iq1");
    assert.equal(resolved.args.at(-1), "IQ1_M");
  });

  it("prefers the model the browser asked for over the one that ran last", () => {
    const resolved = resolveStartArgs("strata", start, model, "coder-iq1", "qwen-iq3");
    assert.equal(resolved.model, "coder-iq1");
  });

  it("appends the model argv after the configured one, keeping the api key and port", () => {
    const resolved = resolveStartArgs("strata", start, model, "coder-iq1", null);
    assert.equal(
      resolved.args.join(" "),
      [...start.args, "--family", "coder", "--model", "IQ1_M"].join(" "),
    );
  });

  it("copies the configured argv so a later start is not affected by the choice", () => {
    const resolved = resolveStartArgs("strata", start, model, "coder-iq1", null);
    assert.equal(start.args.length, 4);
    assert.equal(resolved.args.length, 8);
  });

  it("rejects a model the service does not offer", () => {
    try {
      resolveStartArgs("strata", start, model, "turbo", null);
      throw new Error("no error thrown");
    } catch (error) {
      assert.ok(error instanceof UnknownModelChoiceError);
      assert.equal((error as UnknownModelChoiceError).choice, "turbo");
    }
  });

  it("rejects a remembered model that the service stopped offering", () => {
    try {
      resolveStartArgs("strata", start, model, null, "retired-model");
      throw new Error("no error thrown");
    } catch (error) {
      assert.ok(error instanceof UnknownModelChoiceError);
      assert.equal((error as UnknownModelChoiceError).choice, "retired-model");
    }
  });
});
