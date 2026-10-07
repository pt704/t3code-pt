/**
 * Pure process-table parsing and classification for the Processes page.
 *
 * The tracker snapshots `ps`, `lsof` listeners and `lsof` working directories,
 * then {@link classifyProcesses} turns the flat table into rows: one per
 * command a user or agent started, with its whole subtree folded in.
 */
import type { ProcessListener, ProcessOrigin } from "@t3tools/contracts";

export interface ProcessTableRow {
  readonly pid: number;
  readonly ppid: number;
  readonly uid: number;
  readonly cpuPercent: number;
  readonly rssKb: number;
  readonly startedAtMs: number;
  readonly args: string;
}

export interface TerminalProcessOwner {
  readonly threadId: string;
  readonly terminalId: string;
  readonly pid: number;
}

export interface ClassifiedProcess {
  readonly rootPid: number;
  readonly startedAtMs: number;
  readonly origin: ProcessOrigin | "terminal";
  readonly terminal: { readonly threadId: string; readonly terminalId: string } | null;
  readonly name: string;
  readonly command: string;
  readonly cwd: string | null;
  readonly pids: ReadonlyArray<number>;
  readonly listeners: ReadonlyArray<ProcessListener>;
  readonly cpuPercent: number;
  readonly memoryBytes: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Parses `ps -A -ww -o pid=,ppid=,uid=,pcpu=,rss=,lstart=,args=` run with
 * `LC_ALL=C`. `lstart` is five fixed tokens (`Wed Oct  7 10:12:33 2026`), so
 * splitting on whitespace is safe up to the args column.
 */
export function parsePsOutput(stdout: string): ReadonlyArray<ProcessTableRow> {
  const rows: ProcessTableRow[] = [];
  for (const line of stdout.split("\n")) {
    const match =
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\d{4})\s+(.*)$/.exec(
        line,
      );
    if (!match) continue;
    const month = MONTHS.indexOf(match[6]!);
    if (month < 0) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      uid: Number(match[3]),
      cpuPercent: Number(match[4]),
      rssKb: Number(match[5]),
      // @effect-diagnostics-next-line globalDate:off -- ps prints local wall-clock time; Date resolves the local zone.
      startedAtMs: new Date(
        Number(match[11]),
        month,
        Number(match[7]),
        Number(match[8]),
        Number(match[9]),
        Number(match[10]),
      ).getTime(),
      args: match[12]!.trim(),
    });
  }
  return rows;
}

function parseLsofHostPort(name: string): ProcessListener | null {
  const separator = name.lastIndexOf(":");
  if (separator <= 0) return null;
  const port = Number(name.slice(separator + 1));
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) return null;
  const host = name.slice(0, separator).replace(/^\[|\]$/g, "");
  return { host: host.length === 0 ? "*" : host, port };
}

/** Parses `lsof -iTCP -sTCP:LISTEN -P -n -F pn` into listeners by pid. */
export function parseLsofListeners(
  stdout: string,
): ReadonlyMap<number, ReadonlyArray<ProcessListener>> {
  const byPid = new Map<number, ProcessListener[]>();
  let pid: number | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
      continue;
    }
    if (!line.startsWith("n") || pid === null) continue;
    const listener = parseLsofHostPort(line.slice(1));
    if (!listener) continue;
    const listeners = byPid.get(pid) ?? [];
    if (!listeners.some((existing) => existing.port === listener.port)) listeners.push(listener);
    byPid.set(pid, listeners);
  }
  return byPid;
}

/** Parses `lsof -a -d cwd -F pn` into working directories by pid. */
export function parseLsofCwds(stdout: string): ReadonlyMap<number, string> {
  const byPid = new Map<number, string>();
  let pid: number | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid !== null) byPid.set(pid, line.slice(1));
  }
  return byPid;
}

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "tcsh", "csh", "nu", "pwsh"]);
// Processes that only host other commands. Their children become the rows.
const HOSTS = new Set([...SHELLS, "login", "tmux", "screen", "zellij", "sudo", "su", "env"]);
// Long-lived helpers that sit in a project folder but are not anything a user started.
const IGNORED = new Set(["git", "gitstatusd", "ssh", "ssh-agent", "gpg-agent", "caffeinate"]);
// Sandboxes agents wrap their shell commands in.
const SANDBOX_WRAPPERS = new Set(["sandbox-exec", "bwrap", "codex-linux-sandbox", "env"]);
/** Agent shell commands younger than this are ordinary tool calls, not long-running work. */
export const AGENT_MIN_AGE_MS = 10_000;

function processName(args: string): string {
  const executable = args.split(/\s+/, 1)[0] ?? "";
  const base = executable.slice(executable.lastIndexOf("/") + 1).replace(/^-/, "");
  return base.length > 0 ? base : args.slice(0, 32);
}

const isShellCommand = (args: string) =>
  SHELLS.has(processName(args)) && /\s-[a-zA-Z]*c[a-zA-Z]*\s/.test(` ${args} `);

const isIgnored = (args: string) => {
  const name = processName(args);
  return IGNORED.has(name) || name.startsWith("gitstatusd");
};

// Installed desktop apps and their helpers (editors, chat apps). Bundles
// elsewhere, such as the Command Line Tools' Python.app, are ordinary commands.
const isInstalledApp = (args: string) =>
  /^(\/System)?(\/Users\/[^/]+)?\/Applications\/.*?\.app\/Contents\//.test(args);

/**
 * The command an agent asked for, without the shell wrapper around it.
 * Claude Code runs `zsh -c source <snapshot> && ... && eval '<command>' ...`;
 * Codex runs `bash -lc <command>`.
 */
export function agentCommand(args: string): string {
  const evalMatch = /eval '((?:[^']|'\\'')*)'/.exec(args);
  if (evalMatch) return evalMatch[1]!.replaceAll("'\\''", "'");
  const shellMatch = /^\S+\s+-[a-zA-Z]*c[a-zA-Z]*\s+(.*)$/.exec(args);
  return shellMatch ? shellMatch[1]!.trim() : args;
}

export interface ClassifyInput {
  readonly table: ReadonlyArray<ProcessTableRow>;
  readonly cwdByPid: ReadonlyMap<number, string>;
  readonly listenersByPid: ReadonlyMap<number, ReadonlyArray<ProcessListener>>;
  readonly serverPid: number;
  readonly uid: number | null;
  readonly terminals: ReadonlyArray<TerminalProcessOwner>;
  /** Folders whose processes count as the user's work: project roots and worktrees. */
  readonly isKnownFolder: (cwd: string) => boolean;
  readonly nowMs: number;
}

/**
 * Groups a process table into rows.
 *
 * - Terminal rows: everything below a T3 terminal's shell.
 * - Agent rows: shell commands a provider process (a direct child of the
 *   server) ran for at least {@link AGENT_MIN_AGE_MS}, plus any other server
 *   descendant that listens on a port.
 * - External rows: the user's own processes outside the server that run in a
 *   known folder or listen on a port, folded into their topmost such ancestor.
 */
export function classifyProcesses(input: ClassifyInput): ReadonlyArray<ClassifiedProcess> {
  const byPid = new Map(input.table.map((row) => [row.pid, row]));
  const children = new Map<number, number[]>();
  for (const row of input.table) {
    if (row.pid === row.ppid) continue;
    const siblings = children.get(row.ppid) ?? [];
    siblings.push(row.pid);
    children.set(row.ppid, siblings);
  }
  const descendants = (root: number, exclude?: ReadonlySet<number>): number[] => {
    const found: number[] = [];
    const pending = [...(children.get(root) ?? [])];
    while (pending.length > 0) {
      const pid = pending.pop()!;
      if (exclude?.has(pid)) continue;
      found.push(pid);
      pending.push(...(children.get(pid) ?? []));
    }
    return found;
  };
  const serverTree = new Set([input.serverPid, ...descendants(input.serverPid)]);
  const claimed = new Set<number>();
  const rows: ClassifiedProcess[] = [];

  const makeRow = (
    rootPid: number,
    pids: ReadonlyArray<number>,
    origin: ClassifiedProcess["origin"],
    terminal: ClassifiedProcess["terminal"],
    command: string,
  ): ClassifiedProcess => {
    const root = byPid.get(rootPid)!;
    let cpuPercent = 0;
    let memoryKb = 0;
    const listeners: ProcessListener[] = [];
    for (const pid of pids) {
      const row = byPid.get(pid);
      if (!row) continue;
      cpuPercent += row.cpuPercent;
      memoryKb += row.rssKb;
      for (const listener of input.listenersByPid.get(pid) ?? []) {
        if (!listeners.some((existing) => existing.port === listener.port))
          listeners.push(listener);
      }
    }
    listeners.sort((left, right) => left.port - right.port);
    let cwd: string | null = null;
    for (const pid of pids) {
      cwd = input.cwdByPid.get(pid) ?? null;
      if (cwd !== null) break;
    }
    return {
      rootPid,
      startedAtMs: root.startedAtMs,
      origin,
      terminal,
      name: processName(command),
      command,
      cwd,
      pids,
      listeners,
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memoryBytes: memoryKb * 1024,
    };
  };

  for (const terminal of input.terminals) {
    if (!byPid.has(terminal.pid)) continue;
    const pids = descendants(terminal.pid);
    for (const pid of pids) claimed.add(pid);
    claimed.add(terminal.pid);
    // The foreground job: the first real child, looking through nested
    // interactive shells. Prompt helpers (gitstatusd) and async prompt themes'
    // childless forks of the shell itself are not commands; an idle terminal
    // has none left.
    const firstChild = (pid: number) => {
      const parentName = processName(byPid.get(pid)?.args ?? "");
      return (children.get(pid) ?? [])
        .filter((child) => {
          const args = byPid.get(child)?.args ?? "";
          if (isIgnored(args)) return false;
          return processName(args) !== parentName || (children.get(child)?.length ?? 0) > 0;
        })
        .toSorted((a, b) => a - b)[0];
    };
    let foreground = firstChild(terminal.pid);
    while (foreground !== undefined) {
      const args = byPid.get(foreground)!.args;
      if (!SHELLS.has(processName(args)) || isShellCommand(args)) break;
      foreground = firstChild(foreground);
    }
    if (foreground === undefined || !byPid.has(foreground)) continue;
    rows.push(
      makeRow(
        foreground,
        pids,
        "terminal",
        { threadId: terminal.threadId, terminalId: terminal.terminalId },
        byPid.get(foreground)!.args,
      ),
    );
  }

  const providers = (children.get(input.serverPid) ?? []).filter((pid) => !claimed.has(pid));
  const addAgentRow = (shellPid: number) => {
    const shell = byPid.get(shellPid)!;
    const pids = [shellPid, ...descendants(shellPid)];
    for (const pid of pids) claimed.add(pid);
    if (input.nowMs - shell.startedAtMs < AGENT_MIN_AGE_MS) return;
    rows.push(makeRow(shellPid, pids, "agent", null, agentCommand(shell.args)));
  };
  for (const provider of providers) {
    const pending = [...(children.get(provider) ?? [])];
    while (pending.length > 0) {
      const pid = pending.shift()!;
      if (claimed.has(pid)) continue;
      const args = byPid.get(pid)?.args ?? "";
      if (isShellCommand(args)) addAgentRow(pid);
      else if (SANDBOX_WRAPPERS.has(processName(args))) pending.push(...(children.get(pid) ?? []));
    }
  }
  // Anything else under the server that serves a port, e.g. a dev server an
  // agent started through a wrapper the walk above does not recognise.
  for (const pid of serverTree) {
    if (claimed.has(pid) || pid === input.serverPid || providers.includes(pid)) continue;
    if (!input.listenersByPid.has(pid)) continue;
    let root = pid;
    for (let parent = byPid.get(pid)?.ppid; parent !== undefined;) {
      if (parent === input.serverPid || providers.includes(parent)) break;
      if (isShellCommand(byPid.get(parent)?.args ?? "")) root = parent;
      parent = byPid.get(parent)?.ppid;
    }
    if (claimed.has(root)) continue;
    const pids = [root, ...descendants(root)].filter((candidate) => !claimed.has(candidate));
    for (const candidate of pids) claimed.add(candidate);
    const rootArgs = byPid.get(root)!.args;
    rows.push(
      makeRow(
        root,
        pids,
        "agent",
        null,
        isShellCommand(rootArgs) ? agentCommand(rootArgs) : rootArgs,
      ),
    );
  }

  const isCandidate = (row: ProcessTableRow) => {
    if (serverTree.has(row.pid) || claimed.has(row.pid)) return false;
    if (input.uid !== null && row.uid !== input.uid) return false;
    if (isInstalledApp(row.args)) return false;
    if (HOSTS.has(processName(row.args)) || isIgnored(row.args)) return false;
    const cwd = input.cwdByPid.get(row.pid);
    if (cwd === undefined) return false;
    if (input.isKnownFolder(cwd)) return true;
    return cwd !== "/" && input.listenersByPid.has(row.pid);
  };
  const candidates = new Set(input.table.filter(isCandidate).map((row) => row.pid));
  for (const pid of candidates) {
    let root = pid;
    const seen = new Set<number>([pid]);
    for (let parent = byPid.get(pid)?.ppid; parent !== undefined && !seen.has(parent);) {
      seen.add(parent);
      if (candidates.has(parent)) root = parent;
      parent = byPid.get(parent)?.ppid;
    }
    if (root !== pid) continue;
    const pids = [root, ...descendants(root, serverTree)].filter(
      (candidate) => !claimed.has(candidate),
    );
    for (const candidate of pids) claimed.add(candidate);
    rows.push(makeRow(root, pids, "external", null, byPid.get(root)!.args));
  }
  return rows;
}
