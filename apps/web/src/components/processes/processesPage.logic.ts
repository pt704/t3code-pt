import type { TrackedProcess } from "@t3tools/contracts";

/** A terminal command that has run this long with no output may be stuck. */
export const QUIET_PROCESS_THRESHOLD_MS = 10 * 60_000;

/** Newest first, like an inbox: what you just started is on top. */
export function sortRunningProcesses(
  processes: ReadonlyArray<TrackedProcess>,
): ReadonlyArray<TrackedProcess> {
  return processes.toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
}

/** A project action's name (`dev` for `package.json:dev`), else the command line. */
export function processTitle(
  entry: Pick<TrackedProcess, "actionId" | "actionName" | "command" | "name">,
): string {
  if (entry.actionId === null) return shortCommand(entry);
  if (entry.actionName !== null) return entry.actionName;
  const separator = entry.actionId.indexOf(":");
  return separator > 0 && separator < entry.actionId.length - 1
    ? entry.actionId.slice(separator + 1)
    : entry.actionId;
}

/** A command with its executable's directory dropped: `/usr/bin/python3 -m http.server` → `python3 -m http.server`. */
function shortCommand(entry: Pick<TrackedProcess, "command" | "name">): string {
  const executable = entry.command.split(/\s+/, 1)[0] ?? "";
  return executable.startsWith("/") && executable.endsWith(`/${entry.name}`)
    ? entry.name + entry.command.slice(executable.length)
    : entry.command;
}

/** True when a T3 terminal command has been silent for a long time. */
export function isQuietProcess(entry: TrackedProcess, nowMs: number): boolean {
  if (entry.terminal === null) return false;
  const lastActivity = Date.parse(entry.lastOutputAt ?? entry.startedAt);
  return nowMs - lastActivity >= QUIET_PROCESS_THRESHOLD_MS;
}

export function formatElapsed(fromIso: string, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatMemory(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** The last path segment, for compact worktree labels. */
export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}
