export interface Version {
  raw: string;
  major: number;
  minor: number;
  patch: number;
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/;

export function parseVersion(value: string): Version | null {
  const trimmed = value.trim();
  const match = trimmed.match(VERSION_PATTERN);
  if (match === null) {
    return null;
  }
  return {
    raw: trimmed,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? "0"),
  };
}

export function compareVersions(a: Version, b: Version): number {
  for (const part of [a.major - b.major, a.minor - b.minor, a.patch - b.patch]) {
    if (part !== 0) {
      return part < 0 ? -1 : 1;
    }
  }
  return 0;
}

export function formatVersion(version: Version): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}
