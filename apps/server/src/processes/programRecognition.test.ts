import { describe, expect, it } from "@effect/vitest";

import { recognizeProgram } from "./programRecognition.ts";

const recognize = (
  commands: ReadonlyArray<string>,
  listeningCommands: ReadonlyArray<string> = [],
) => recognizeProgram({ commands, listeningCommands });

describe("recognizeProgram", () => {
  it("names the framework a package-manager script runs", () => {
    expect(
      recognize([
        "pnpm run dev",
        "node /work/app/node_modules/.bin/../vite/bin/vite.js --port 5173",
      ])?.label,
    ).toBe("Vite");
    expect(recognize(["npm run dev", "next-server (v15.1.0)"])?.label).toBe("Next.js");
    expect(recognize(["node /work/app/node_modules/nuxi/bin/nuxi.mjs dev"])?.id).toBe("nuxt");
    expect(recognize(["node ./node_modules/.bin/../vite-plus/bin/vp run dev:desktop"])?.label).toBe(
      "Vite+",
    );
  });

  it("recognizes agent CLIs, and lets an agent win over the servers it started", () => {
    expect(recognize(["/Users/me/.local/bin/claude --resume"])).toEqual({
      kind: "agent",
      id: "claude",
      label: "Claude Code",
      driverKind: "claudeAgent",
    });
    expect(recognize(["node /opt/homebrew/bin/codex", "pnpm dev", "node vite.js"])?.id).toBe(
      "codex",
    );
    expect(
      recognize(["node /usr/lib/node_modules/@google/gemini-cli/dist/index.js"])?.driverKind,
    ).toBeNull();
  });

  it("falls back to the runtime serving a port, and names databases", () => {
    expect(recognize(["node server.js"], ["node server.js"])?.label).toBe("Node server");
    expect(recognize(["python3 -m http.server 8000"], ["python3 -m http.server 8000"])?.label).toBe(
      "Python server",
    );
    const macPython =
      "/Library/Python3.framework/Resources/Python.app/Contents/MacOS/Python -m http.server";
    expect(recognize([macPython], [macPython])?.label).toBe("Python server");
    expect(recognize(["/opt/homebrew/opt/postgresql@16/bin/postgres -D /var/pg"])?.kind).toBe(
      "database",
    );
  });

  it("leaves unrecognized commands alone", () => {
    expect(recognize(["grep claude notes.md"])).toBeNull();
    expect(recognize(["node build.js"])).toBeNull();
    expect(recognize(["sleep 300"])).toBeNull();
  });
});
