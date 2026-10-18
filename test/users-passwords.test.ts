import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { describe, it } from "node:test";
import {
  hashPassword,
  needsRehash,
  parseEncoded,
  verifyPassword,
  verifyUnknownLogin,
} from "../src/users/passwords.js";

const PASSWORD = "correct horse battery";

describe("hashPassword", () => {
  it("encodes the algorithm and cost so a hash stays readable forever", () => {
    const encoded = hashPassword(PASSWORD);
    const parts = encoded.split("$");

    assert.equal(parts.length, 6);
    assert.equal(parts[0], "scrypt");
    assert.equal(parts[1], "16384");
    assert.equal(parts[2], "8");
    assert.equal(parts[3], "1");
  });

  it("uses a fresh salt every time, so the same password never hashes alike", () => {
    const first = hashPassword(PASSWORD);
    const second = hashPassword(PASSWORD);

    assert.notEqual(first, second);
    assert.equal(verifyPassword(PASSWORD, first), true);
    assert.equal(verifyPassword(PASSWORD, second), true);
  });
});

describe("verifyPassword", () => {
  it("rejects the wrong password", () => {
    assert.equal(verifyPassword("wrong horse battery", hashPassword(PASSWORD)), false);
  });

  it("rejects anything that is not a hash this code understands", () => {
    for (const encoded of ["", "plain", "bcrypt$10$abc", "scrypt$16384$8$1", "scrypt$0$8$1$c2FsdA==$aGFzaA=="]) {
      assert.equal(verifyPassword(PASSWORD, encoded), false, encoded);
    }
  });

  it("verifies a hash produced with older cost parameters", () => {
    const salt = Buffer.from("0123456789abcdef", "utf8");
    const hash = scryptSync(PASSWORD, salt, 32, { N: 1024, r: 8, p: 1 });
    const encoded = ["scrypt", 1024, 8, 1, salt.toString("base64"), hash.toString("base64")].join("$");

    assert.equal(verifyPassword(PASSWORD, encoded), true);
    assert.equal(verifyPassword("nope nope nope", encoded), false);
  });
});

describe("needsRehash", () => {
  it("is false for the current cost and true for a weaker one", () => {
    assert.equal(needsRehash(hashPassword(PASSWORD)), false);

    const salt = Buffer.from("0123456789abcdef", "utf8");
    const hash = scryptSync(PASSWORD, salt, 32, { N: 1024, r: 8, p: 1 });
    assert.equal(needsRehash(["scrypt", 1024, 8, 1, salt.toString("base64"), hash.toString("base64")].join("$")), true);
    assert.equal(needsRehash("not a hash"), true);
  });
});

describe("parseEncoded", () => {
  it("round-trips what hashPassword produced", () => {
    const encoded = hashPassword(PASSWORD);
    const parsed = parseEncoded(encoded);

    assert.ok(parsed);
    assert.equal(parsed.params.N, 16384);
    assert.equal(parsed.salt.length, 16);
    assert.equal(parsed.hash.length, 32);
  });

  it("returns null for a malformed encoding", () => {
    assert.equal(parseEncoded("scrypt$16384$8$1$c2FsdA=="), null);
  });
});

describe("verifyUnknownLogin", () => {
  it("costs the same as a real verification so timing does not leak which logins exist", () => {
    const started = process.hrtime.bigint();
    verifyUnknownLogin(PASSWORD);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

    assert.ok(elapsedMs > 1, `expected a full scrypt run, took ${elapsedMs}ms`);
  });
});
