import { ProjectId, type ProjectScript } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { upsertSavedAction } from "./savedActions.ts";

const projectId = ProjectId.make("project-1");
const setup: ProjectScript = {
  id: "setup",
  name: "Setup",
  command: "pnpm install",
  icon: "configure",
  runOnWorktreeCreate: true,
};
const dev: ProjectScript = {
  id: "dev",
  name: "Dev",
  command: "pnpm dev",
  icon: "play",
  runOnWorktreeCreate: false,
  previewUrl: "http://localhost:5173",
  autoOpenPreview: true,
};

describe("upsertSavedAction", () => {
  it("adds a new action with a free id and an icon guessed from its name", () => {
    const result = upsertSavedAction(
      [setup, dev],
      { projectId, name: "Test", command: "pnpm test" },
      ["setup", "dev", "test"],
    );
    expect(result?.action).toEqual({
      id: "test-2",
      name: "Test",
      command: "pnpm test",
      icon: "test",
      runOnWorktreeCreate: false,
    });
    expect(result?.scripts.map((script) => script.id)).toEqual(["setup", "dev", "test-2"]);
  });

  it("replaces a saved action in place, keeping its preview and setup settings", () => {
    const result = upsertSavedAction(
      [setup, dev],
      { projectId, actionId: "dev", name: "Web", command: "pnpm dev --port 3000", icon: "debug" },
      [],
    );
    expect(result?.scripts).toEqual([
      setup,
      { ...dev, name: "Web", command: "pnpm dev --port 3000", icon: "debug" },
    ]);
  });

  it("refuses to edit an action that is not saved", () => {
    expect(
      upsertSavedAction(
        [setup],
        { projectId, actionId: "package.json:dev", name: "Dev", command: "pnpm dev" },
        [],
      ),
    ).toBeNull();
  });
});
