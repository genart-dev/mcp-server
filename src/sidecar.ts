/**
 * Sidecar mutation bridge.
 * When running as a desktop app sidecar (--mode sidecar), sends IPC
 * messages to the parent Electron process for real-time UI updates.
 */

/** Mutation types sent to the desktop app. */
export type MutationType =
  | "sketch:created"
  | "sketch:updated"
  | "sketch:deleted"
  | "workspace:updated"
  | "selection:changed";

/** Whether the server is running in sidecar mode. */
export function isSidecarMode(): boolean {
  const modeIdx = process.argv.indexOf("--mode");
  if (modeIdx !== -1 && process.argv[modeIdx + 1] === "sidecar") return true;
  return process.env.GENART_SIDECAR === "1";
}

/**
 * Notify the parent process of a mutation.
 * No-op when not in sidecar mode or when IPC channel is unavailable.
 */
export function notifyMutation(type: string, payload: unknown): void {
  if (isSidecarMode() && typeof process.send === "function") {
    process.send({ type, payload });
  }
}
