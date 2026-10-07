import { describe, expect, it } from "@effect/vitest";

import {
  makefileActions,
  packageJsonActions,
  procfileActions,
  withoutSaved,
} from "./actionDiscovery.ts";

describe("packageJsonActions", () => {
  it("uses the declared package manager and skips lifecycle hooks", () => {
    const actions = packageJsonActions(
      JSON.stringify({
        packageManager: "pnpm@11.0.0",
        scripts: { dev: "vite", predev: "x", "test:e2e": "playwright test", prepare: "husky" },
      }),
      new Set(["yarn.lock"]),
    );
    expect(actions.map((action) => [action.id, action.command, action.icon])).toEqual([
      ["package.json:dev", "pnpm run dev", "play"],
      ["package.json:test:e2e", "pnpm run test:e2e", "test"],
    ]);
  });

  it("falls back to the lockfile, then npm", () => {
    const content = JSON.stringify({ scripts: { build: "tsc" } });
    expect(packageJsonActions(content, new Set(["yarn.lock"]))[0]!.command).toBe("yarn build");
    expect(packageJsonActions(content, new Set(["bun.lock"]))[0]!.command).toBe("bun run build");
    expect(packageJsonActions(content, new Set())[0]!.command).toBe("npm run build");
  });

  it("ignores unreadable package.json files", () => {
    expect(packageJsonActions("{", new Set())).toEqual([]);
  });
});

describe("makefileActions", () => {
  it("lists explicit targets only", () => {
    const actions = makefileActions(
      [
        "CC := clang",
        ".PHONY: test",
        "build: deps",
        "\tcc main.c",
        "%.o: %.c",
        "test:",
        "x ::= 1",
      ].join("\n"),
    );
    expect(actions.map((action) => action.command)).toEqual(["make build", "make test"]);
  });
});

describe("procfileActions", () => {
  it("reads process types", () => {
    expect(procfileActions("web: bundle exec rails s\n# comment\nworker: sidekiq\n")).toEqual([
      expect.objectContaining({ id: "Procfile:web", command: "bundle exec rails s" }),
      expect.objectContaining({ id: "Procfile:worker", command: "sidekiq" }),
    ]);
  });
});

describe("withoutSaved", () => {
  it("drops discovered commands that are already saved actions", () => {
    const discovered = packageJsonActions(
      JSON.stringify({ scripts: { dev: "x", lint: "y" } }),
      new Set(),
    );
    const saved = [{ ...discovered[0]!, id: "dev", source: "saved" as const }];
    expect(withoutSaved(discovered, saved).map((action) => action.name)).toEqual(["lint"]);
  });
});
