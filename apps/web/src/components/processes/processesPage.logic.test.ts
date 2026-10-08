import type { TrackedProcess } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatElapsed,
  isQuietProcess,
  processTitle,
  QUIET_PROCESS_THRESHOLD_MS,
  sortRunningProcesses,
} from "./processesPage.logic";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");

const process = (overrides: Partial<TrackedProcess>): TrackedProcess => ({
  id: "1@1",
  pid: 1,
  name: "node",
  command: "node server.js",
  cwd: "/work/app",
  program: null,
  hostApp: null,
  startedAt: new Date(NOW - 60_000).toISOString(),
  origin: "external",
  terminal: null,
  actionId: null,
  startedBy: null,
  projectId: null,
  workspaceRoot: null,
  branch: null,
  threadIds: [],
  listeners: [],
  cpuPercent: 0,
  memoryBytes: 0,
  processCount: 1,
  lastOutputAt: null,
  canRestart: false,
  ...overrides,
});

describe("sortRunningProcesses", () => {
  it("puts the most recently started process first", () => {
    const older = process({ id: "old", startedAt: new Date(NOW - 60_000).toISOString() });
    const newer = process({ id: "new", startedAt: new Date(NOW - 1_000).toISOString() });
    expect(sortRunningProcesses([older, newer]).map((entry) => entry.id)).toEqual(["new", "old"]);
  });
});

describe("processTitle", () => {
  it("names discovered and saved actions by their action name", () => {
    expect(processTitle({ actionId: "package.json:dev", command: "node vite" })).toBe("dev");
    expect(processTitle({ actionId: "dev-server", command: "node vite" })).toBe("dev-server");
    expect(processTitle({ actionId: null, command: "node vite" })).toBe("node vite");
  });
});

describe("isQuietProcess", () => {
  const terminal = { threadId: "t", terminalId: "term-1" };

  it("flags terminal commands that have been silent past the threshold", () => {
    const silentSince = new Date(NOW - QUIET_PROCESS_THRESHOLD_MS).toISOString();
    expect(isQuietProcess(process({ terminal, lastOutputAt: silentSince }), NOW)).toBe(true);
    expect(
      isQuietProcess(process({ terminal, lastOutputAt: new Date(NOW - 1000).toISOString() }), NOW),
    ).toBe(false);
  });

  it("never flags processes T3 Code cannot see the output of", () => {
    expect(isQuietProcess(process({ startedAt: new Date(0).toISOString() }), NOW)).toBe(false);
  });
});

describe("formatElapsed", () => {
  it("scales units with the duration", () => {
    const ago = (ms: number) => new Date(NOW - ms).toISOString();
    expect(formatElapsed(ago(42_000), NOW)).toBe("42s");
    expect(formatElapsed(ago(5 * 60_000), NOW)).toBe("5m");
    expect(formatElapsed(ago(125 * 60_000), NOW)).toBe("2h 5m");
    expect(formatElapsed(ago(72 * 3_600_000), NOW)).toBe("3d");
  });
});
