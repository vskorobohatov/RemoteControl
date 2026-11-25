import { spawn } from "node:child_process";
import { runCommand } from "../lib/run.js";
import type { PowerStatus } from "../types.js";

/** logind's two verbs, spelled the way its Manager interface spells them. */
export type PowerVerb = "PowerOff" | "Reboot";

/** The word logind answers for CanPowerOff/CanReboot, plus what a broken probe means. */
export type PowerCapability = "yes" | "no" | "challenge" | "auth" | "unknown";

export interface PowerResult {
  ok: boolean;
  httpStatus: number;
  message: string;
}

const LOGIN1 = ["org.freedesktop.login1", "/org/freedesktop/login1", "org.freedesktop.login1.Manager"] as const;
const PROBE_TIMEOUT_MS = 5_000;

const ACTIONS: Record<PowerVerb, { command: string; args: string[]; label: string }> = {
  PowerOff: { command: "systemctl", args: ["poweroff"], label: "shut down" },
  Reboot: { command: "systemctl", args: ["reboot"], label: "reboot" },
};

const CAPABILITY_WORDS: readonly PowerCapability[] = ["yes", "no", "challenge", "auth"];

/**
 * Powering the host is logind's job, not this server's: `systemctl poweroff` run by an
 * unprivileged user is routed to logind, which authorizes it through the same polkit
 * check `CanPowerOff` reports. That is why the action is asked for only after the probe
 * answered "yes" - a refusal is then a 409 the card can explain, never a hung request.
 */
export class HostControl {
  async status(): Promise<PowerStatus> {
    const [shutdown, restart] = await Promise.all([capability("PowerOff"), capability("Reboot")]);
    return {
      canShutdown: shutdown === "yes",
      canRestart: restart === "yes",
      detail: detailFor(shutdown, restart),
    };
  }

  async shutdown(): Promise<PowerResult> {
    return act("PowerOff");
  }

  async restart(): Promise<PowerResult> {
    return act("Reboot");
  }
}

async function capability(verb: PowerVerb): Promise<PowerCapability> {
  const probe = await runCommand("busctl", ["call", ...LOGIN1, `Can${verb}`], PROBE_TIMEOUT_MS).catch(() => null);
  if (probe === null || probe.code !== 0) {
    return "unknown";
  }
  return parseCapability(probe.stdout);
}

/** busctl prints the variant with its signature in front: `s "yes"`. */
export function parseCapability(stdout: string): PowerCapability {
  const word = /"([^"]*)"/.exec(stdout)?.[1] ?? "";
  return CAPABILITY_WORDS.includes(word as PowerCapability) ? (word as PowerCapability) : "unknown";
}

function detailFor(shutdown: PowerCapability, restart: PowerCapability): string {
  if (shutdown === "yes" && restart === "yes") {
    return "logind grants this session both power off and reboot";
  }
  const refused = [
    shutdown !== "yes" ? `power off: ${shutdown}` : null,
    restart !== "yes" ? `reboot: ${restart}` : null,
  ].filter((entry): entry is string => entry !== null);
  return `logind refuses this session (${refused.join(", ")}) - it needs an active login session, and sudo is never asked for`;
}

async function act(verb: PowerVerb): Promise<PowerResult> {
  const action = ACTIONS[verb];
  const granted = await capability(verb);
  if (granted !== "yes") {
    return {
      ok: false,
      httpStatus: 409,
      message: `logind will not ${action.label} this host for this session (${granted})`,
    };
  }

  /* logind starts taking the machine down the moment it accepts, and this server is
     inside the session it is taking down, so waiting for the command would trade a
     truthful 202 for a request the browser never hears back. */
  const child = spawn(action.command, action.args, { stdio: "ignore", detached: true });
  child.once("error", () => undefined);
  child.unref();
  return { ok: true, httpStatus: 202, message: `${action.label} requested - this host and its dashboard are going down` };
}
