// Pure helpers for the processing switch and processing keys on Admin > Connected systems
// (file-hooks spec D1, D4, R5.6).
import { EXTERNAL_RESULT_TIMEOUT_MINUTES } from "@/services/file-hook-timeouts";
import type { ConnectedSystem } from "@/services/integration-clients.functions";
import { PROCESSING_SCOPES, processingScope } from "@/services/processing-keys";
import type { Scope } from "@/services/tmf667-mapper";

export const switchKey = ["processingSwitch"] as const;
export type Step = "scan" | "read";
const N = EXTERNAL_RESULT_TIMEOUT_MINUTES;
export const STEP_COPY: Record<
  Step,
  { title: string; own: string; builtIn: string; on: string; off: string; disconnect: string }
> = {
  scan: {
    title: "Checking files for threats",
    own: "your own antivirus",
    builtIn: "the built-in check",
    on: `Files wait for your own antivirus. The built-in check stops. If it doesn't answer within ${N} minutes, files fail and can be tried again.`,
    off: "Files will use the built-in check again: protection is weaker.",
    disconnect: `Files already waiting for it fail after ${N} minutes and can be tried again. New files wait until another system that checks files is connected.`,
  },
  read: {
    title: "Reading details from files",
    own: "your own reader",
    builtIn: "the built-in reader",
    on: `Files wait for your own reader. The built-in reading stops. If it doesn't answer within ${N} minutes, files fail and can be tried again, or kept without reading.`,
    off: "Files will use the built-in reader again.",
    disconnect: `Files already waiting for it fail after ${N} minutes and can be tried again. New files wait until another system that reads files is connected.`,
  },
};
const SCOPE_OF: Record<Step, "scan" | "extract"> = { scan: "scan", read: "extract" };

/** The connected system a step waits for, if one is connected (one of each kind, BR-163). */
export function systemFor(systems: readonly ConnectedSystem[], step: Step): ConnectedSystem | null {
  return systems.find((s) => !s.revokedAt && processingScope(s.scopes) === SCOPE_OF[step]) ?? null;
}

/** What disconnecting a system means for files, when files wait for it (D1); else null. */
export function disconnectWarning(
  s: ConnectedSystem,
  sw: { scan: boolean; read: boolean } | undefined,
): string | null {
  const scope = processingScope(s.scopes);
  if (!scope) return null;
  const step: Step = scope === "scan" ? "scan" : "read";
  // When the switch could not be read, say it anyway: saying too much beats a surprise.
  return sw === undefined || sw[step] ? STEP_COPY[step].disconnect : null;
}

const isProcessing = (s: Scope) => (PROCESSING_SCOPES as readonly string[]).includes(s);
/**
 * Checking a permission: checking files and reading files each need a key of their own (D4), so
 * choosing one of them clears the others, and choosing another permission clears them.
 */
export function withScope(prev: readonly Scope[], s: Scope): Scope[] {
  if (isProcessing(s)) return [s];
  return [...prev.filter((x) => !isProcessing(x)), s];
}
