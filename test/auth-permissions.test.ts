import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { can, permissionsOf } from "../src/auth/permissions.js";
import { USER_ROLES, type Permission, type UserRole } from "../src/types.js";

const ALL: Permission[] = [
  "services:view",
  "services:control",
  "services:logs",
  "metrics:view",
  "update:view",
  "update:apply",
  "users:manage",
];

const EXPECTED: Record<UserRole, Permission[]> = {
  admin: ALL,
  manager: ["services:view", "services:control", "services:logs", "metrics:view", "update:view"],
  guest: ["services:view"],
};

describe("permissions matrix", () => {
  it("matches the documented matrix exactly", () => {
    for (const role of USER_ROLES) {
      assert.deepEqual(permissionsOf(role), EXPECTED[role], role);
    }
  });

  it("gives a guest nothing but a look at what is running", () => {
    for (const permission of ALL) {
      assert.equal(can("guest", permission), permission === "services:view", `guest / ${permission}`);
    }
  });

  it("lets a manager run services and watch the machine, but not manage accounts or ship updates", () => {
    assert.equal(can("manager", "services:control"), true);
    assert.equal(can("manager", "services:logs"), true);
    assert.equal(can("manager", "metrics:view"), true);
    assert.equal(can("manager", "update:view"), true);
    assert.equal(can("manager", "update:apply"), false);
    assert.equal(can("manager", "users:manage"), false);
  });

  it("gives an admin everything, including the ability to change who else may do what", () => {
    for (const permission of ALL) {
      assert.equal(can("admin", permission), true, `admin / ${permission}`);
    }
  });

  it("refuses an unknown permission instead of defaulting to allow", () => {
    assert.equal(can("admin", "not:a:permission" as Permission), false);
  });
});
