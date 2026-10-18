import type { Permission, UserRole } from "../types.js";

/**
 * The whole authorization model in one table. Adding a feature means adding a permission
 * here and naming it in the route; nothing else has to know about roles.
 *
 * admin   everything, including who else may do what
 * manager runs the services and watches the machine, but cannot change accounts or ship an update
 * guest   sees what is running, nothing else
 */
const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: [
    "services:view",
    "services:control",
    "services:logs",
    "metrics:view",
    "update:view",
    "update:apply",
    "users:manage",
  ],
  manager: ["services:view", "services:control", "services:logs", "metrics:view", "update:view"],
  guest: ["services:view"],
};

const LOOKUP: Record<UserRole, ReadonlySet<Permission>> = {
  admin: new Set(ROLE_PERMISSIONS.admin),
  manager: new Set(ROLE_PERMISSIONS.manager),
  guest: new Set(ROLE_PERMISSIONS.guest),
};

export function can(role: UserRole, permission: Permission): boolean {
  return LOOKUP[role]?.has(permission) ?? false;
}

/** Sent to the client with the session so the UI hides exactly what the server refuses. */
export function permissionsOf(role: UserRole): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}
