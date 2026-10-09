/**
 * Tracks long-running processes across T3 terminals, agent shells and the
 * rest of the machine, and runs project actions in project-level terminals.
 *
 * Scans run on demand and are shared: a scan younger than
 * {@link SCAN_REUSE_MS} is reused, and subscribers poll every
 * {@link POLL_INTERVAL} only while subscribed.
 */
import {
  ProcessNotFoundError,
  ProcessOperationError,
  ProcessRestartUnsupportedError,
  ProjectActionNotFoundError,
  ProjectActionWorkspaceError,
  ThreadId,
  type ProcessStarter,
  type ProcessTerminalRef,
  type ProjectAction,
  type ProjectActionDeleteInput,
  type ProjectActionList,
  type ProjectActionListInput,
  type ProjectActionRun,
  type ProjectActionRunInput,
  type ProjectActionSaveInput,
  type ProjectId,
  type ProjectScript,
  type ProcessesError,
  type TerminalSummary,
  type TrackedProcess,
  type TrackedProcessInput,
  type TrackedProcessList,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { projectScriptRuntimeEnv, resolveProjectScripts } from "@t3tools/shared/projectScripts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as T3ProjectFileLoader from "../project/T3ProjectFileLoader.ts";
import * as Settings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  actionIcon,
  makefileActions,
  PACKAGE_LOCKFILES,
  packageJsonActions,
  procfileActions,
  withoutSaved,
} from "./actionDiscovery.ts";
import { upsertSavedAction } from "./savedActions.ts";
import {
  classifyProcesses,
  parseLsofCwds,
  parseLsofListeners,
  parsePsOutput,
  type ClassifiedProcess,
} from "./processTree.ts";

export class ProcessTracker extends Context.Service<
  ProcessTracker,
  {
    /** One scan, reusing a very recent one. */
    readonly list: Effect.Effect<TrackedProcessList, ProcessOperationError>;
    /** The process list now, then again whenever it changes, while consumed. */
    readonly subscribe: Stream.Stream<TrackedProcessList>;
    /**
     * Stops a process tree. Terminal commands get Ctrl-C first; anything
     * still alive after that gets SIGTERM, then SIGKILL.
     */
    readonly stop: (input: TrackedProcessInput) => Effect.Effect<void, ProcessesError>;
    /** Stops a project action and runs its command again in the same terminal. */
    readonly restart: (input: TrackedProcessInput) => Effect.Effect<void, ProcessesError>;
    /** Saved actions plus commands discovered in the repository. */
    readonly listActions: (
      input: ProjectActionListInput,
    ) => Effect.Effect<ProjectActionList, ProcessesError>;
    /**
     * Runs a saved or discovered action in a project-level terminal. Each run
     * while another is still going starts a new instance in its own terminal.
     */
    readonly runAction: (
      input: ProjectActionRunInput,
      startedBy: ProcessStarter,
    ) => Effect.Effect<ProcessTerminalRef, ProcessesError>;
    /**
     * Saves a new action for the project, or replaces a saved one. The first
     * change to a project that inherits the environment's actions gives it
     * its own copy, as editing them in Settings does.
     */
    readonly saveAction: (
      input: ProjectActionSaveInput,
    ) => Effect.Effect<ProjectAction, ProcessesError>;
    /** Removes a saved action from the project. */
    readonly deleteAction: (input: ProjectActionDeleteInput) => Effect.Effect<void, ProcessesError>;
  }
>()("t3/processes/ProcessTracker") {}

const POLL_INTERVAL = Duration.seconds(3);
const SCAN_REUSE_MS = 1_500;
const FOLDER_INDEX_TTL_MS = 30_000;
const SCAN_TIMEOUT = Duration.seconds(5);
const STOP_INTERRUPT_GRACE_MS = 2_000;
const STOP_TERM_GRACE_MS = 3_000;
const MAX_THREADS_PER_PROCESS = 5;
/** A terminal that was just handed a command counts as busy before its metadata catches up. */
const ACTION_START_GRACE_MS = 5_000;

/** Project actions run in terminals under this synthetic thread id. */
const PROJECT_ACTION_THREAD_PREFIX = "project-actions:";

const actionThreadId = (projectId: string) => `${PROJECT_ACTION_THREAD_PREFIX}${projectId}`;

/** FNV-1a, so one action gets a separate terminal per worktree. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** `action:<actionId>:<checkout hash>`, plus `:<n>` for the second and later instances. */
const actionTerminalId = (actionId: string, workspaceRoot: string, instance: number) =>
  `action:${actionId}:${shortHash(workspaceRoot)}${instance > 1 ? `:${instance}` : ""}`;

function parseActionTerminal(
  summary: Pick<TerminalSummary, "threadId" | "terminalId">,
): { readonly projectId: string; readonly actionId: string } | null {
  if (!summary.threadId.startsWith(PROJECT_ACTION_THREAD_PREFIX)) return null;
  const match = /^action:(.+):[0-9a-f]{8}(?::\d+)?$/.exec(summary.terminalId);
  if (!match) return null;
  return {
    projectId: summary.threadId.slice(PROJECT_ACTION_THREAD_PREFIX.length),
    actionId: match[1]!,
  };
}

const isoFromMillis = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

const processId = (row: { readonly rootPid: number; readonly startedAtMs: number }) =>
  `${row.rootPid}@${row.startedAtMs}`;

interface Folder {
  /** The path as T3 Code knows it, which clients compare against. */
  readonly root: string;
  /** The resolved path, which `lsof` reports working directories under. */
  readonly realRoot: string;
  readonly projectId: ProjectId;
  readonly threadIds: ReadonlyArray<ThreadId>;
}

const terminalKey = (threadId: string, terminalId: string) => `${threadId}\u0000${terminalId}`;

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const signal = (pid: number, name: NodeJS.Signals) =>
  Effect.sync(() => {
    try {
      process.kill(pid, name);
    } catch {
      // Already gone, or not ours to signal.
    }
  });

const make = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const terminals = yield* TerminalManager.TerminalManager;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const settings = yield* Settings.ServerSettingsService;
  const t3ProjectFiles = yield* T3ProjectFileLoader.T3ProjectFileLoader;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const serverPid = process.pid;
  const uid = typeof process.getuid === "function" ? process.getuid() : null;

  const terminalSummaries = new Map<string, TerminalSummary>();
  // Who started each action terminal's current command, and when. In memory:
  // after a server restart the starter is unknown.
  const actionStarts = new Map<
    string,
    { startedBy: ProcessStarter; atMs: number; actionName: string }
  >();
  const lastOutputAt = new Map<string, number>();
  const unsubscribeMetadata = yield* terminals.subscribeMetadata((event) =>
    Effect.sync(() => {
      if (event.type === "snapshot") {
        terminalSummaries.clear();
        for (const terminal of event.terminals)
          terminalSummaries.set(terminalKey(terminal.threadId, terminal.terminalId), terminal);
      } else if (event.type === "upsert") {
        terminalSummaries.set(
          terminalKey(event.terminal.threadId, event.terminal.terminalId),
          event.terminal,
        );
      } else {
        terminalSummaries.delete(terminalKey(event.threadId, event.terminalId));
        lastOutputAt.delete(terminalKey(event.threadId, event.terminalId));
        actionStarts.delete(terminalKey(event.threadId, event.terminalId));
      }
    }),
  );
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribeMetadata));
  const unsubscribeEvents = yield* terminals.subscribe((event) =>
    event.type === "output"
      ? Clock.currentTimeMillis.pipe(
          Effect.map((now) => lastOutputAt.set(terminalKey(event.threadId, event.terminalId), now)),
          Effect.asVoid,
        )
      : Effect.void,
  );
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribeEvents));

  const realPath = (target: string) =>
    fileSystem.realPath(target).pipe(Effect.orElseSucceed(() => target));

  const folderIndexRef = yield* Ref.make<{
    readonly builtAtMs: number;
    readonly folders: ReadonlyArray<Folder>;
  } | null>(null);

  const buildFolderIndex = Effect.gen(function* () {
    const projectShells = yield* projects.listShells().pipe(Effect.orElseSucceed(() => []));
    const shellSnapshot = yield* threads
      .getShellSnapshot({ location: "active" })
      .pipe(Effect.option);
    const byRealRoot = new Map<
      string,
      { root: string; projectId: ProjectId; threadIds: ThreadId[] }
    >();
    const add = (root: string, projectId: ProjectId, threadId?: ThreadId) =>
      Effect.gen(function* () {
        const realRoot = yield* realPath(root);
        const entry = byRealRoot.get(realRoot) ?? { root, projectId, threadIds: [] };
        if (threadId !== undefined) entry.threadIds.push(threadId);
        byRealRoot.set(realRoot, entry);
      });
    yield* Effect.forEach(
      projectShells,
      (project) =>
        Effect.gen(function* () {
          yield* add(project.workspaceRoot, project.id);
          const worktrees = yield* git
            .listWorktreePaths(project.workspaceRoot)
            .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
          for (const worktree of worktrees) yield* add(worktree, project.id);
        }),
      { concurrency: 4, discard: true },
    );
    if (Option.isSome(shellSnapshot)) {
      for (const thread of shellSnapshot.value.threads) {
        if (thread.worktreePath === null) continue;
        yield* add(thread.worktreePath, thread.projectId, thread.id);
      }
    }
    return [...byRealRoot.entries()]
      .map(([realRoot, entry]) => ({ realRoot, ...entry }))
      .toSorted((left, right) => right.realRoot.length - left.realRoot.length);
  });

  const folderIndex = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const cached = yield* Ref.get(folderIndexRef);
    if (cached !== null && now - cached.builtAtMs < FOLDER_INDEX_TTL_MS) return cached.folders;
    const folders = yield* buildFolderIndex;
    yield* Ref.set(folderIndexRef, { builtAtMs: now, folders });
    return folders;
  });

  const folderFor = (folders: ReadonlyArray<Folder>, cwd: string) =>
    folders.find(
      (folder) => cwd === folder.realRoot || cwd.startsWith(`${folder.realRoot}${path.sep}`),
    ) ?? null;

  /** Reads the checked-out branch from HEAD without spawning git. */
  const readBranch = (root: string) =>
    Effect.gen(function* () {
      const dotGit = path.join(root, ".git");
      const info = yield* fileSystem.stat(dotGit);
      let gitDir = dotGit;
      if (info.type === "File") {
        const pointer = /^gitdir:\s*(.+)$/m.exec(yield* fileSystem.readFileString(dotGit));
        if (!pointer) return null;
        gitDir = path.resolve(root, pointer[1]!.trim());
      }
      const head = yield* fileSystem.readFileString(path.join(gitDir, "HEAD"));
      return /^ref: refs\/heads\/(.+)$/m.exec(head)?.[1]?.trim() ?? null;
    }).pipe(Effect.orElseSucceed(() => null));

  const runTool = (command: string, args: ReadonlyArray<string>) =>
    processRunner
      .run({
        command,
        args,
        env: { ...process.env, LC_ALL: "C" },
        timeout: SCAN_TIMEOUT,
        maxOutputBytes: 8 * 1024 * 1024,
        outputMode: "truncate",
      })
      .pipe(
        Effect.map((result) => result.stdout),
        Effect.orElseSucceed(() => ""),
      );

  // Every live terminal, not only those flagged busy: that flag lags by a poll,
  // and a command it misses would otherwise look like it belongs to an agent.
  const liveTerminals = () =>
    [...terminalSummaries.values()].filter(
      (terminal) => terminal.status === "running" && terminal.pid !== null,
    );

  const toTrackedProcess = (
    row: ClassifiedProcess,
    folders: ReadonlyArray<Folder>,
    branches: ReadonlyMap<string, string | null>,
  ): TrackedProcess => {
    const folder = row.cwd === null ? null : folderFor(folders, row.cwd);
    const action = row.terminal === null ? null : parseActionTerminal(row.terminal);
    const key =
      row.terminal === null ? null : terminalKey(row.terminal.threadId, row.terminal.terminalId);
    const outputAt = key === null ? undefined : lastOutputAt.get(key);
    const start = key === null ? undefined : actionStarts.get(key);
    const startedBy = start?.startedBy ?? null;
    const threadIds =
      row.terminal !== null && action === null
        ? [ThreadId.make(row.terminal.threadId)]
        : startedBy?.threadId
          ? [startedBy.threadId]
          : (folder?.threadIds.slice(0, MAX_THREADS_PER_PROCESS) ?? []);
    return {
      id: processId(row),
      pid: row.rootPid,
      name: row.name,
      command: row.command.slice(0, 2_000),
      cwd: row.cwd,
      program: row.program,
      hostApp: row.hostApp,
      startedAt: isoFromMillis(row.startedAtMs),
      origin: action === null ? row.origin : "action",
      terminal: row.terminal,
      actionId: action?.actionId ?? null,
      actionName: action === null ? null : (start?.actionName ?? null),
      startedBy,
      projectId: folder?.projectId ?? null,
      workspaceRoot: folder?.root ?? null,
      branch: folder === null ? null : (branches.get(folder.root) ?? null),
      threadIds,
      listeners: row.listeners,
      cpuPercent: row.cpuPercent,
      memoryBytes: row.memoryBytes,
      processCount: row.pids.length,
      lastOutputAt: outputAt === undefined ? null : isoFromMillis(outputAt),
      canRestart: action !== null,
    };
  };

  const actionRuns = (nowMs: number): ReadonlyArray<ProjectActionRun> =>
    [...terminalSummaries.values()].flatMap((terminal) => {
      const action = parseActionTerminal(terminal);
      if (action === null) return [];
      const start = actionStarts.get(terminalKey(terminal.threadId, terminal.terminalId));
      return [
        {
          projectId: action.projectId as ProjectId,
          actionId: action.actionId,
          workspaceRoot: terminal.worktreePath ?? terminal.cwd,
          terminal: { threadId: terminal.threadId, terminalId: terminal.terminalId },
          // A command just handed to the shell counts as running before the
          // terminal reports its subprocess, so a new run never reads "Finished".
          running:
            terminal.status === "running" &&
            (terminal.hasRunningSubprocess ||
              (start !== undefined && nowMs - start.atMs < ACTION_START_GRACE_MS)),
          updatedAt: terminal.updatedAt,
        },
      ];
    });

  const scanNow = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    if (platform === "win32") {
      // No cheap process table here: list running T3 terminals only.
      return {
        processes: [],
        actionRuns: actionRuns(nowMs),
        externalDiscovery: false,
        scannedAt: isoFromMillis(nowMs),
      } satisfies TrackedProcessList;
    }
    const [psOut, listenersOut, cwdsOut, folders] = yield* Effect.all(
      [
        runTool("ps", ["-A", "-ww", "-o", "pid=,ppid=,uid=,pcpu=,rss=,lstart=,args="]),
        runTool("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"]),
        runTool("lsof", [
          "-nP",
          "-a",
          "-d",
          "cwd",
          ...(uid === null ? [] : ["-u", String(uid)]),
          "-F",
          "pn",
        ]),
        folderIndex,
      ],
      { concurrency: "unbounded" },
    );
    const classified = classifyProcesses({
      table: parsePsOutput(psOut),
      cwdByPid: parseLsofCwds(cwdsOut),
      listenersByPid: parseLsofListeners(listenersOut),
      serverPid,
      uid,
      terminals: liveTerminals().map((terminal) => ({
        threadId: terminal.threadId,
        terminalId: terminal.terminalId,
        pid: terminal.pid!,
      })),
      isKnownFolder: (cwd) => folderFor(folders, cwd) !== null,
      nowMs,
    });
    const roots = new Set(
      classified.flatMap((row) => {
        const folder = row.cwd === null ? null : folderFor(folders, row.cwd);
        return folder === null ? [] : [folder.root];
      }),
    );
    const branches = new Map<string, string | null>();
    yield* Effect.forEach(
      roots,
      (root) => readBranch(root).pipe(Effect.map((branch) => branches.set(root, branch))),
      { concurrency: 8, discard: true },
    );
    return {
      processes: classified
        .map((row) => toTrackedProcess(row, folders, branches))
        .toSorted((left, right) => left.startedAt.localeCompare(right.startedAt)),
      actionRuns: actionRuns(nowMs),
      externalDiscovery: true,
      scannedAt: isoFromMillis(nowMs),
    } satisfies TrackedProcessList;
  });

  const scanLock = yield* Semaphore.make(1);
  const lastScan = yield* Ref.make<{
    readonly atMs: number;
    readonly list: TrackedProcessList;
  } | null>(null);
  const list: ProcessTracker["Service"]["list"] = scanLock
    .withPermits(1)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const cached = yield* Ref.get(lastScan);
        if (cached !== null && now - cached.atMs < SCAN_REUSE_MS) return cached.list;
        const scanned = yield* scanNow;
        yield* Ref.set(lastScan, { atMs: yield* Clock.currentTimeMillis, list: scanned });
        return scanned;
      }),
    )
    .pipe(Effect.withSpan("ProcessTracker.list"));

  const fresh = Ref.set(lastScan, null).pipe(Effect.andThen(list));

  const sameList = (left: TrackedProcessList, right: TrackedProcessList) =>
    JSON.stringify({ ...left, scannedAt: "" }) === JSON.stringify({ ...right, scannedAt: "" });

  const subscribe: ProcessTracker["Service"]["subscribe"] = Stream.tick(POLL_INTERVAL).pipe(
    Stream.mapEffect(() =>
      list.pipe(
        Effect.tapError((error) => Effect.logWarning("process scan failed", { cause: error })),
        Effect.option,
      ),
    ),
    Stream.filter(Option.isSome),
    Stream.map((result) => result.value),
    Stream.changesWith(sameList),
  );

  const findProcess = (id: string) =>
    fresh.pipe(
      Effect.flatMap((current) => {
        const found = current.processes.find((entry) => entry.id === id);
        return found === undefined
          ? Effect.fail(new ProcessNotFoundError({ processId: id }))
          : Effect.succeed(found);
      }),
    );

  const pidsOf = (entry: TrackedProcess) =>
    Effect.gen(function* () {
      const table = parsePsOutput(
        yield* runTool("ps", ["-A", "-ww", "-o", "pid=,ppid=,uid=,pcpu=,rss=,lstart=,args="]),
      );
      const children = new Map<number, number[]>();
      for (const row of table) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid]);
      const pids = [entry.pid];
      for (let index = 0; index < pids.length; index += 1)
        pids.push(...(children.get(pids[index]!) ?? []));
      return pids;
    });

  const waitForExit = (pids: ReadonlyArray<number>, timeoutMs: number) =>
    Effect.gen(function* () {
      const deadline = (yield* Clock.currentTimeMillis) + timeoutMs;
      while ((yield* Clock.currentTimeMillis) < deadline) {
        if (!pids.some(isAlive)) return true;
        yield* Effect.sleep(Duration.millis(100));
      }
      return !pids.some(isAlive);
    });

  const stopEntry = (entry: TrackedProcess) =>
    Effect.gen(function* () {
      const pids = yield* pidsOf(entry);
      if (entry.terminal !== null) {
        yield* terminals.write({ ...entry.terminal, data: "\u0003" }).pipe(Effect.ignore);
        if (yield* waitForExit([entry.pid], STOP_INTERRUPT_GRACE_MS)) return;
      }
      yield* Effect.forEach(pids, (pid) => signal(pid, "SIGTERM"), { discard: true });
      if (yield* waitForExit(pids, STOP_TERM_GRACE_MS)) return;
      yield* Effect.forEach(pids.filter(isAlive), (pid) => signal(pid, "SIGKILL"), {
        discard: true,
      });
      yield* waitForExit(pids, STOP_TERM_GRACE_MS);
    }).pipe(Effect.ensuring(Ref.set(lastScan, null)));

  const stop: ProcessTracker["Service"]["stop"] = (input) =>
    findProcess(input.processId).pipe(
      Effect.flatMap(stopEntry),
      Effect.withSpan("ProcessTracker.stop"),
    );

  const projectOf = (projectId: ProjectId, actionId: string) =>
    projects.getById(projectId).pipe(
      Effect.mapError((cause) => new ProcessOperationError({ operation: "list-actions", cause })),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new ProjectActionNotFoundError({ projectId, actionId })),
          onSome: Effect.succeed,
        }),
      ),
    );

  /** The project's root or one of its worktrees; anything else is refused. */
  const resolveWorkspace = (
    project: { readonly id: ProjectId; readonly workspaceRoot: string },
    requested: string | undefined,
  ) =>
    Effect.gen(function* () {
      if (requested === undefined) return project.workspaceRoot;
      const target = yield* realPath(requested);
      if (target === (yield* realPath(project.workspaceRoot))) return project.workspaceRoot;
      const worktrees = yield* git
        .listWorktreePaths(project.workspaceRoot)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      for (const worktree of worktrees) if ((yield* realPath(worktree)) === target) return worktree;
      return yield* new ProjectActionWorkspaceError({ projectId: project.id });
    });

  const fileIfExists = (target: string) => fileSystem.readFileString(target).pipe(Effect.option);

  const discover = (root: string) =>
    Effect.gen(function* () {
      const lockfiles = new Set<string>();
      for (const name of PACKAGE_LOCKFILES)
        if (yield* fileSystem.exists(path.join(root, name)).pipe(Effect.orElseSucceed(() => false)))
          lockfiles.add(name);
      const [packageJson, makefile, procfile, t3File] = yield* Effect.all(
        [
          fileIfExists(path.join(root, "package.json")),
          fileIfExists(path.join(root, "Makefile")),
          fileIfExists(path.join(root, "Procfile")),
          t3ProjectFiles.load(root),
        ],
        { concurrency: "unbounded" },
      );
      const t3Actions: ReadonlyArray<ProjectAction> = Option.match(t3File, {
        onNone: () => [],
        onSome: (file) =>
          (file.scripts ?? []).map((script) => ({
            id: `t3.json:${script.name}`,
            name: script.name,
            command: script.command,
            icon: script.icon ?? actionIcon(script.name),
            source: "t3.json" as const,
          })),
      });
      return [
        ...t3Actions,
        ...Option.match(packageJson, {
          onNone: () => [],
          onSome: (content) => packageJsonActions(content, lockfiles),
        }),
        ...Option.match(makefile, { onNone: () => [], onSome: makefileActions }),
        ...Option.match(procfile, { onNone: () => [], onSome: procfileActions }),
      ];
    });

  const actionsFor = (projectId: ProjectId, requestedRoot: string | undefined) =>
    Effect.gen(function* () {
      const project = yield* projectOf(projectId, "");
      const root = yield* resolveWorkspace(project, requestedRoot);
      const current = yield* settings.getSettings.pipe(
        Effect.mapError((cause) => new ProcessOperationError({ operation: "list-actions", cause })),
      );
      const saved: ReadonlyArray<ProjectAction> = resolveProjectScripts(current, project).map(
        (script) => ({
          id: script.id,
          name: script.name,
          command: script.command,
          icon: script.icon,
          source: "saved" as const,
        }),
      );
      const discovered = withoutSaved(yield* discover(root), saved);
      return { project, root, saved, discovered };
    });

  const listActions: ProcessTracker["Service"]["listActions"] = (input) =>
    actionsFor(input.projectId, input.workspaceRoot).pipe(
      Effect.map(({ saved, discovered }) => ({ saved, discovered })),
      Effect.withSpan("ProcessTracker.listActions"),
    );

  /** The first instance terminal of an action in a checkout that is not running anything. */
  const freeActionTerminal = (
    projectId: ProjectId,
    actionId: string,
    root: string,
    nowMs: number,
  ) => {
    const threadId = actionThreadId(projectId);
    for (let instance = 1; ; instance += 1) {
      const terminalId = actionTerminalId(actionId, root, instance);
      const key = terminalKey(threadId, terminalId);
      const summary = terminalSummaries.get(key);
      const start = actionStarts.get(key);
      const busy =
        (summary?.status === "running" && summary.hasRunningSubprocess) ||
        (start !== undefined && nowMs - start.atMs < ACTION_START_GRACE_MS);
      if (!busy) return { threadId, terminalId };
    }
  };

  const startAction = (
    input: ProjectActionRunInput,
    startedBy: ProcessStarter,
    target?: ProcessTerminalRef,
  ) =>
    Effect.gen(function* () {
      const { project, root, saved, discovered } = yield* actionsFor(
        input.projectId,
        input.workspaceRoot,
      );
      const action = [...saved, ...discovered].find((entry) => entry.id === input.actionId);
      if (action === undefined)
        return yield* new ProjectActionNotFoundError({
          projectId: input.projectId,
          actionId: input.actionId,
        });
      const nowMs = yield* Clock.currentTimeMillis;
      const terminal = target ?? freeActionTerminal(project.id, action.id, root, nowMs);
      actionStarts.set(terminalKey(terminal.threadId, terminal.terminalId), {
        startedBy,
        actionName: action.name,
        atMs: nowMs,
      });
      yield* terminals
        .open({
          ...terminal,
          cwd: root,
          worktreePath: root === project.workspaceRoot ? null : root,
          env: projectScriptRuntimeEnv({
            project: { cwd: project.workspaceRoot },
            worktreePath: root === project.workspaceRoot ? null : root,
          }),
        })
        .pipe(
          Effect.flatMap(() => terminals.write({ ...terminal, data: `${action.command}\r` })),
          Effect.mapError((cause) => new ProcessOperationError({ operation: "run-action", cause })),
        );
      yield* Ref.set(lastScan, null);
      return terminal;
    });

  const runAction: ProcessTracker["Service"]["runAction"] = (input, startedBy) =>
    startAction(input, startedBy).pipe(Effect.withSpan("ProcessTracker.runAction"));

  const restart: ProcessTracker["Service"]["restart"] = (input) =>
    Effect.gen(function* () {
      const entry = yield* findProcess(input.processId);
      const action = entry.terminal === null ? null : parseActionTerminal(entry.terminal);
      if (entry.terminal === null || action === null)
        return yield* new ProcessRestartUnsupportedError({ processId: input.processId });
      const key = terminalKey(entry.terminal.threadId, entry.terminal.terminalId);
      const summary = terminalSummaries.get(key);
      const startedBy = actionStarts.get(key)?.startedBy ?? { kind: "user", threadId: null };
      yield* stopEntry(entry);
      yield* startAction(
        {
          projectId: action.projectId as ProjectId,
          actionId: action.actionId,
          ...(summary === undefined ? {} : { workspaceRoot: summary.worktreePath ?? summary.cwd }),
        },
        startedBy,
        entry.terminal,
      );
    }).pipe(Effect.withSpan("ProcessTracker.restart"));

  const savedActionsLock = yield* Semaphore.make(1);

  /** Reads, edits and writes back a project's saved actions, one edit at a time. */
  const editSavedActions = <A>(
    projectId: ProjectId,
    actionId: string,
    operation: "save-action" | "delete-action",
    edit: (
      scripts: ReadonlyArray<ProjectScript>,
      takenIds: ReadonlyArray<string>,
    ) => { readonly scripts: ReadonlyArray<ProjectScript>; readonly result: A } | null,
  ) =>
    savedActionsLock.withPermits(1)(
      Effect.gen(function* () {
        const project = yield* projectOf(projectId, actionId);
        const current = yield* settings.getSettings.pipe(
          Effect.mapError((cause) => new ProcessOperationError({ operation, cause })),
        );
        const scripts = resolveProjectScripts(current, project);
        const takenIds = [
          ...current.defaultProjectScripts,
          ...Object.values(current.projectSettingsOverrides).flatMap(
            (entry) => entry.defaultProjectScripts ?? [],
          ),
          ...project.scripts,
        ].map((script) => script.id);
        const edited = edit(scripts, takenIds);
        if (edited === null) return yield* new ProjectActionNotFoundError({ projectId, actionId });
        yield* settings
          .updateSettings({
            projectSettingsOverrides: {
              [project.id]: {
                ...current.projectSettingsOverrides[project.id],
                defaultProjectScripts: edited.scripts,
              },
            },
          })
          .pipe(Effect.mapError((cause) => new ProcessOperationError({ operation, cause })));
        return edited.result;
      }),
    );

  const saveAction: ProcessTracker["Service"]["saveAction"] = (input) =>
    editSavedActions(input.projectId, input.actionId ?? "", "save-action", (scripts, takenIds) => {
      const saved = upsertSavedAction(scripts, input, takenIds);
      if (saved === null) return null;
      const { id, name, command, icon } = saved.action;
      return {
        scripts: saved.scripts,
        result: { id, name, command, icon, source: "saved" as const },
      };
    }).pipe(Effect.withSpan("ProcessTracker.saveAction"));

  const deleteAction: ProcessTracker["Service"]["deleteAction"] = (input) =>
    editSavedActions(input.projectId, input.actionId, "delete-action", (scripts) =>
      scripts.some((script) => script.id === input.actionId)
        ? { scripts: scripts.filter((script) => script.id !== input.actionId), result: undefined }
        : null,
    ).pipe(Effect.withSpan("ProcessTracker.deleteAction"));

  return ProcessTracker.of({
    list,
    subscribe,
    stop,
    restart,
    listActions,
    runAction,
    saveAction,
    deleteAction,
  });
});

export const layer = Layer.effect(ProcessTracker, make);
