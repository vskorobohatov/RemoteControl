export type ControlSize = "sm" | "md" | "lg";

export type Tone = "ok" | "warn" | "danger" | "external" | "primary" | "accent";

export function classnames(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((part) => part !== false && part !== null && part !== undefined).join(" ");
}

export type ClassMap<Keys extends string> = Record<Keys, string | undefined>;
