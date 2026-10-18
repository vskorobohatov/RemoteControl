import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const ALGORITHM = "scrypt";
const KEY_LENGTH = 32;
const SALT_BYTES = 16;
/* 16 MiB of work per hash: slow enough that an offline copy of the database is not a
   password list, fast enough that a login is still under a tenth of a second. */
const CURRENT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export interface EncodedHash {
  salt: Buffer;
  hash: Buffer;
  params: ScryptParams;
}

/** "scrypt$N$r$p$<salt base64>$<hash base64>" - self-describing, so the cost can be raised later. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, KEY_LENGTH, CURRENT_PARAMS);
  const params = [ALGORITHM, CURRENT_PARAMS.N, CURRENT_PARAMS.r, CURRENT_PARAMS.p];
  return [...params, salt.toString("base64"), hash.toString("base64")].join("$");
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parsed = parseEncoded(encoded);
  if (parsed === null) {
    return false;
  }
  const hash = scryptSync(password, parsed.salt, KEY_LENGTH, parsed.params);
  return hash.length === parsed.hash.length && timingSafeEqual(hash, parsed.hash);
}

export function needsRehash(encoded: string): boolean {
  const parsed = parseEncoded(encoded);
  if (parsed === null) {
    return true;
  }
  return parsed.params.N !== CURRENT_PARAMS.N || parsed.params.r !== CURRENT_PARAMS.r || parsed.params.p !== CURRENT_PARAMS.p;
}

let placeholderHash: string | null = null;

/**
 * Logging in with an unknown login still has to cost a full scrypt run, otherwise the
 * response time alone tells an attacker whether the login exists.
 */
export function verifyUnknownLogin(password: string): void {
  placeholderHash ??= hashPassword("remotecontrol-placeholder");
  verifyPassword(password, placeholderHash);
}

export function parseEncoded(encoded: string): EncodedHash | null {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== ALGORITHM) {
    return null;
  }
  const params: ScryptParams = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) };
  if (![params.N, params.r, params.p].every((value) => Number.isInteger(value) && value > 0)) {
    return null;
  }
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const hash = Buffer.from(parts[5] ?? "", "base64");
  if (salt.length === 0 || hash.length === 0) {
    return null;
  }
  return { salt, hash, params };
}
