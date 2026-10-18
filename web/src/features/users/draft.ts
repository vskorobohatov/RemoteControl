import type { UserRole } from "@server/types";

export const MIN_LOGIN_LENGTH = 2;
export const MIN_PASSWORD_LENGTH = 10;

export interface UserDraft {
  login: string;
  password: string;
  role: UserRole;
}

export function emptyDraft(): UserDraft {
  return { login: "", password: "", role: "guest" };
}

export function draftFor(user: { login: string; role: UserRole }): UserDraft {
  return { login: user.login, password: "", role: user.role };
}

export function toPatch(draft: UserDraft): { login?: string; role?: UserRole; password?: string } {
  const input: { login?: string; role?: UserRole; password?: string } = { role: draft.role };
  if (draft.login.trim().length > 0) {
    input.login = draft.login.trim();
  }
  if (draft.password.length > 0) {
    input.password = draft.password;
  }
  return input;
}
