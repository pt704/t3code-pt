import { describe, expect, it } from "@effect/vitest";

import {
  AGENT_MIN_AGE_MS,
  agentCommand,
  classifyProcesses,
  parseLsofCwds,
  parseLsofListeners,
  parsePsOutput,
  type ClassifyInput,
  type ProcessTableRow,
} from "./processTree.ts";

const NOW = 1_800_000_000_000;
const SERVER = 100;
const UID = 501;

const row = (
  pid: number,
  ppid: number,
  args: string,
  overrides: Partial<ProcessTableRow> = {},
) => ({
  pid,
  ppid,
  uid: UID,
  cpuPercent: 1,
  rssKb: 1024,
  startedAtMs: NOW - 60_000,
  args,
  ...overrides,
});

const classify = (overrides: Partial<ClassifyInput>) =>
  classifyProcesses({
    table: [],
    cwdByPid: new Map(),
    listenersByPid: new Map(),
    serverPid: SERVER,
    uid: UID,
    terminals: [],
    isKnownFolder: (cwd) => cwd.startsWith("/work/app"),
    nowMs: NOW,
    ...overrides,
  });

describe("parsePsOutput", () => {
  it("reads lstart as local time and keeps the full command line", () => {
    const [parsed] = parsePsOutput(
      "  4242     1   501   3.5  20480 Wed Oct  7 10:12:33 2026     node ./node_modules/.bin/vite --port 5173\n",
    );
    expect(parsed).toEqual({
      pid: 4242,
      ppid: 1,
      uid: 501,
      cpuPercent: 3.5,
      rssKb: 20480,
      // @effect-diagnostics-next-line globalDate:off -- the parser reads local wall-clock time.
      startedAtMs: new Date(2026, 9, 7, 10, 12, 33).getTime(),
      args: "node ./node_modules/.bin/vite --port 5173",
    });
  });
});

describe("lsof parsers", () => {
  it("collects one listener per port and strips IPv6 brackets", () => {
    const listeners = parseLsofListeners(
      "p10\nf3\nn*:5173\nf4\nn[::1]:5173\np11\nn127.0.0.1:3000\nn[::1]:9229\n",
    );
    expect(listeners.get(10)).toEqual([{ host: "*", port: 5173 }]);
    expect(listeners.get(11)).toEqual([
      { host: "127.0.0.1", port: 3000 },
      { host: "::1", port: 9229 },
    ]);
  });

  it("maps working directories by pid", () => {
    expect(parseLsofCwds("p1\nfcwd\nn/\np2\nfcwd\nn/work/app\n")).toEqual(
      new Map([
        [1, "/"],
        [2, "/work/app"],
      ]),
    );
  });
});

describe("agentCommand", () => {
  it("unwraps Claude Code's eval wrapper", () => {
    expect(
      agentCommand(
        "/bin/zsh -c source /Users/me/.claude/shell-snapshots/s.sh 2>/dev/null || true && eval 'pnpm run dev -- --port 3001' \\< /dev/null && pwd -P >| /tmp/cwd",
      ),
    ).toBe("pnpm run dev -- --port 3001");
  });

  it("unwraps a plain shell -c command", () => {
    expect(agentCommand("bash -lc npm test")).toBe("npm test");
  });
});

describe("classifyProcesses", () => {
  it("folds a terminal's foreground job and its children into one row with their ports", () => {
    const rows = classify({
      table: [
        row(SERVER, 1, "node server.js"),
        row(200, SERVER, "/bin/zsh -o nopromptsp"),
        row(201, 200, "gitstatusd-darwin-arm64 -s -1"),
        row(210, 200, "pnpm run dev"),
        row(211, 210, "node vite", { cpuPercent: 4 }),
      ],
      listenersByPid: new Map([[211, [{ host: "*", port: 5173 }]]]),
      cwdByPid: new Map([[210, "/work/app"]]),
      terminals: [{ threadId: "thread-1", terminalId: "term-1", pid: 200 }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rootPid: 210,
      origin: "terminal",
      terminal: { threadId: "thread-1", terminalId: "term-1" },
      command: "pnpm run dev",
      cwd: "/work/app",
      listeners: [{ host: "*", port: 5173 }],
    });
  });

  it("keeps terminal commands out of the agent bucket and skips idle prompts", () => {
    const rows = classify({
      table: [
        row(SERVER, 1, "node server.js"),
        // An action terminal running a dev server, behind an async prompt fork.
        row(200, SERVER, "/bin/zsh -o nopromptsp"),
        row(201, 200, "/bin/zsh -o nopromptsp"),
        row(210, 200, "pnpm run dev"),
        row(211, 210, "node vite"),
        // An idle terminal whose only child is the prompt fork.
        row(300, SERVER, "/bin/zsh -o nopromptsp"),
        row(301, 300, "/bin/zsh -o nopromptsp"),
      ],
      listenersByPid: new Map([[211, [{ host: "*", port: 5173 }]]]),
      terminals: [
        { threadId: "project-actions:p", terminalId: "action:dev:00000000", pid: 200 },
        { threadId: "thread-1", terminalId: "term-1", pid: 300 },
      ],
    });
    expect(rows.map((entry) => [entry.rootPid, entry.origin, entry.terminal?.terminalId])).toEqual([
      [210, "terminal", "action:dev:00000000"],
    ]);
  });

  it("reports long-running agent shell commands but not short tool calls or the agent itself", () => {
    const rows = classify({
      table: [
        row(SERVER, 1, "node server.js"),
        row(300, SERVER, "claude --output-format stream-json"),
        row(310, 300, "/bin/zsh -c eval 'pnpm dev'"),
        row(311, 310, "node next dev"),
        row(320, 300, "/bin/zsh -c eval 'ls'", { startedAtMs: NOW - AGENT_MIN_AGE_MS + 1 }),
        row(330, 300, "node mcp-server.js"),
      ],
      cwdByPid: new Map([[310, "/work/app"]]),
    });
    expect(rows.map((entry) => [entry.rootPid, entry.origin, entry.command])).toEqual([
      [310, "agent", "pnpm dev"],
    ]);
    expect(rows[0]!.pids).toEqual([310, 311]);
  });

  it("finds external processes in project folders or on ports and skips apps, shells and system daemons", () => {
    const rows = classify({
      table: [
        row(SERVER, 1, "node server.js"),
        row(400, 1, "/Applications/iTerm.app/Contents/MacOS/iTerm2"),
        row(401, 400, "-zsh"),
        row(402, 401, "npm run dev"),
        row(403, 402, "node vite"),
        row(410, 1, "/opt/homebrew/bin/postgres -D /opt/homebrew/var/postgres"),
        row(420, 1, "/usr/libexec/rapportd"),
        row(430, 1, "/Applications/Code.app/Contents/Frameworks/Code Helper (Plugin)"),
        row(440, 401, "gitstatusd-darwin-arm64"),
        row(450, 1, "node other-user.js", { uid: 0 }),
        row(
          460,
          1,
          "/Library/Developer/CommandLineTools/Python.app/Contents/MacOS/Python -m http.server",
        ),
      ],
      cwdByPid: new Map([
        [401, "/work/app"],
        [402, "/work/app"],
        [403, "/work/app"],
        [410, "/opt/homebrew/var/postgres"],
        [420, "/"],
        [430, "/work/app"],
        [440, "/work/app"],
        [450, "/work/app"],
        [460, "/work/app/docs"],
      ]),
      listenersByPid: new Map([
        [403, [{ host: "127.0.0.1", port: 5173 }]],
        [410, [{ host: "127.0.0.1", port: 5432 }]],
        [420, [{ host: "*", port: 7000 }]],
      ]),
    });
    expect(rows.map((entry) => [entry.rootPid, entry.origin, entry.listeners[0]?.port])).toEqual([
      [402, "external", 5173],
      [410, "external", 5432],
      [460, "external", undefined],
    ]);
    expect(rows[0]!.pids.toSorted()).toEqual([402, 403]);
  });

  it("never reports the server's own process tree as external", () => {
    const rows = classify({
      table: [
        row(90, 1, "node dev-runner.ts"),
        row(SERVER, 90, "node server.js"),
        row(500, SERVER, "t3-resource-monitor"),
      ],
      cwdByPid: new Map([
        [90, "/work/app"],
        [SERVER, "/work/app"],
        [500, "/work/app"],
      ]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rootPid: 90, pids: [90] });
  });
});
