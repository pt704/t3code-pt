import * as Schema from "effect/Schema";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProjectScriptIcon } from "./project.ts";

/**
 * Where a tracked process came from.
 * - `terminal`: a command running in a thread's T3 terminal.
 * - `action`: a project action started from the Processes page or an agent.
 * - `agent`: a shell command an agent started (often in the background).
 * - `external`: started outside T3 Code, e.g. from iTerm or an editor.
 */
export const ProcessOrigin = Schema.Literals(["terminal", "action", "agent", "external"]);
export type ProcessOrigin = typeof ProcessOrigin.Type;

export const ProcessListener = Schema.Struct({
  host: TrimmedNonEmptyString,
  port: Schema.Int.check(Schema.isGreaterThan(0)).check(Schema.isLessThan(65536)),
});
export type ProcessListener = typeof ProcessListener.Type;

export const ProcessTerminalRef = Schema.Struct({
  threadId: TrimmedNonEmptyString,
  terminalId: TrimmedNonEmptyString,
});
export type ProcessTerminalRef = typeof ProcessTerminalRef.Type;

/**
 * One row on the Processes page: a process tree rooted at the command a user
 * or agent started. CPU and memory cover the whole tree.
 */
/**
 * Who started a project action: the user from a client, or an agent through
 * the MCP tools (with the thread it ran in, when known).
 */
export const ProcessStarter = Schema.Struct({
  kind: Schema.Literals(["user", "agent"]),
  threadId: Schema.NullOr(ThreadId),
});
export type ProcessStarter = typeof ProcessStarter.Type;

/**
 * What a process tree runs, when T3 Code recognizes it: a coding agent such as
 * Claude Code, a dev server or tool such as Vite, or a database.
 */
export const RecognizedProgram = Schema.Struct({
  kind: Schema.Literals(["agent", "server", "database"]),
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  /** The T3 Code provider whose icon this agent shares, when T3 Code supports it. */
  driverKind: Schema.NullOr(TrimmedNonEmptyString),
});
export type RecognizedProgram = typeof RecognizedProgram.Type;

export const TrackedProcess = Schema.Struct({
  /** `<pid>@<startedAtMs>`; stays stable for the life of the process and never matches a reused pid. */
  id: TrimmedNonEmptyString,
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  name: TrimmedNonEmptyString,
  command: Schema.String,
  cwd: Schema.NullOr(TrimmedNonEmptyString),
  program: Schema.NullOr(RecognizedProgram),
  /** The desktop app an external process runs under, such as iTerm2 or another T3 Code (macOS). */
  hostApp: Schema.NullOr(TrimmedNonEmptyString),
  startedAt: IsoDateTime,
  origin: ProcessOrigin,
  terminal: Schema.NullOr(ProcessTerminalRef),
  actionId: Schema.NullOr(TrimmedNonEmptyString),
  /** Known for project actions started since the server last restarted. */
  startedBy: Schema.NullOr(ProcessStarter),
  projectId: Schema.NullOr(ProjectId),
  /** The project root or worktree the process runs in. */
  workspaceRoot: Schema.NullOr(TrimmedNonEmptyString),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  /** Threads tied to the process: its terminal's thread, or the threads that own its worktree. */
  threadIds: Schema.Array(ThreadId),
  listeners: Schema.Array(ProcessListener),
  cpuPercent: Schema.Number,
  memoryBytes: NonNegativeInt,
  processCount: Schema.Int.check(Schema.isGreaterThan(0)),
  /** Last terminal output, for spotting stuck commands. Null outside T3 terminals. */
  lastOutputAt: Schema.NullOr(IsoDateTime),
  canRestart: Schema.Boolean,
});
export type TrackedProcess = typeof TrackedProcess.Type;

/** A project action's terminal, running or finished. Lets the page reopen its output. */
export const ProjectActionRun = Schema.Struct({
  projectId: ProjectId,
  actionId: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  terminal: ProcessTerminalRef,
  running: Schema.Boolean,
  updatedAt: IsoDateTime,
});
export type ProjectActionRun = typeof ProjectActionRun.Type;

export const TrackedProcessList = Schema.Struct({
  processes: Schema.Array(TrackedProcess),
  actionRuns: Schema.Array(ProjectActionRun),
  /** False where only T3 terminals can be inspected (Windows). */
  externalDiscovery: Schema.Boolean,
  scannedAt: IsoDateTime,
});
export type TrackedProcessList = typeof TrackedProcessList.Type;

const ProjectActionSource = Schema.Literals([
  "saved",
  "package.json",
  "t3.json",
  "Makefile",
  "Procfile",
]);

/**
 * A runnable project action: a saved project script, or a command discovered
 * in the repository that the user has not saved yet.
 */
export const ProjectAction = Schema.Struct({
  /** A saved script's id, or `<source>:<name>` for a discovered command. */
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  source: ProjectActionSource,
});
export type ProjectAction = typeof ProjectAction.Type;

export const ProjectActionListInput = Schema.Struct({
  projectId: ProjectId,
  /** Read discoverable commands from this worktree instead of the project root. */
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectActionListInput = typeof ProjectActionListInput.Type;

export const ProjectActionList = Schema.Struct({
  saved: Schema.Array(ProjectAction),
  discovered: Schema.Array(ProjectAction),
});
export type ProjectActionList = typeof ProjectActionList.Type;

export const ProjectActionRunInput = Schema.Struct({
  projectId: ProjectId,
  actionId: TrimmedNonEmptyString,
  /** A worktree of the project to run in. Defaults to the project root. */
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectActionRunInput = typeof ProjectActionRunInput.Type;

export const TrackedProcessInput = Schema.Struct({
  processId: TrimmedNonEmptyString,
});
export type TrackedProcessInput = typeof TrackedProcessInput.Type;

export class ProcessNotFoundError extends Schema.TaggedError<ProcessNotFoundError>()(
  "ProcessNotFoundError",
  { processId: Schema.String },
) {
  override get message(): string {
    return "The process is no longer running.";
  }
}

export class ProcessRestartUnsupportedError extends Schema.TaggedError<ProcessRestartUnsupportedError>()(
  "ProcessRestartUnsupportedError",
  { processId: Schema.String },
) {
  override get message(): string {
    return "Only project actions can be restarted; T3 Code does not know how this process was started.";
  }
}

export class ProjectActionNotFoundError extends Schema.TaggedError<ProjectActionNotFoundError>()(
  "ProjectActionNotFoundError",
  { projectId: Schema.String, actionId: Schema.String },
) {
  override get message(): string {
    return "The project or action was not found.";
  }
}

export class ProjectActionWorkspaceError extends Schema.TaggedError<ProjectActionWorkspaceError>()(
  "ProjectActionWorkspaceError",
  { projectId: Schema.String },
) {
  override get message(): string {
    return "The folder is not the project's root or one of its worktrees.";
  }
}

export class ProcessOperationError extends Schema.TaggedError<ProcessOperationError>()(
  "ProcessOperationError",
  {
    operation: Schema.Literals(["scan", "stop", "restart", "run-action", "list-actions"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Process operation '${this.operation}' failed.`;
  }
}

export const ProcessesError = Schema.Union([
  ProcessNotFoundError,
  ProcessRestartUnsupportedError,
  ProjectActionNotFoundError,
  ProjectActionWorkspaceError,
  ProcessOperationError,
]);
export type ProcessesError = typeof ProcessesError.Type;
