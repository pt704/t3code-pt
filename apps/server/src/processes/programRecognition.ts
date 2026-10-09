/**
 * Names the program a process tree runs, so the Processes page can say
 * "Vite" or "Claude Code" instead of `pnpm run dev` or `node …/cli.js`.
 */
import type { RecognizedProgram } from "@t3tools/contracts";

interface ProgramPattern {
  readonly kind: RecognizedProgram["kind"];
  readonly id: string;
  readonly label: string;
  readonly driverKind?: string;
  /** Program names, after looking past runners like `node` and stripping paths and extensions. */
  readonly names: ReadonlyArray<string>;
  /** npm packages, matched as `/node_modules/<package>/` or `<package>@` anywhere in the command. */
  readonly packages?: ReadonlyArray<string>;
}

const AGENTS: ReadonlyArray<ProgramPattern> = [
  {
    kind: "agent",
    id: "claude",
    label: "Claude Code",
    driverKind: "claudeAgent",
    names: ["claude"],
    packages: ["@anthropic-ai/claude-code"],
  },
  {
    kind: "agent",
    id: "codex",
    label: "Codex",
    driverKind: "codex",
    names: ["codex"],
    packages: ["@openai/codex"],
  },
  {
    kind: "agent",
    id: "cursor",
    label: "Cursor Agent",
    driverKind: "cursor",
    names: ["cursor-agent"],
  },
  { kind: "agent", id: "grok", label: "Grok", driverKind: "grok", names: ["grok"] },
  {
    kind: "agent",
    id: "opencode",
    label: "OpenCode",
    driverKind: "opencode",
    names: ["opencode"],
    packages: ["opencode-ai"],
  },
  {
    kind: "agent",
    id: "pi",
    label: "Pi",
    driverKind: "pi",
    names: ["pi"],
    packages: ["@mariozechner/pi-coding-agent"],
  },
  {
    kind: "agent",
    id: "gemini",
    label: "Gemini CLI",
    names: ["gemini"],
    packages: ["@google/gemini-cli"],
  },
  {
    kind: "agent",
    id: "copilot",
    label: "Copilot CLI",
    names: ["copilot"],
    packages: ["@github/copilot"],
  },
  { kind: "agent", id: "amp", label: "Amp", names: ["amp"], packages: ["@sourcegraph/amp"] },
  { kind: "agent", id: "aider", label: "Aider", names: ["aider"] },
  { kind: "agent", id: "goose", label: "Goose", names: ["goose"] },
  {
    kind: "agent",
    id: "qwen",
    label: "Qwen Code",
    names: ["qwen"],
    packages: ["@qwen-code/qwen-code"],
  },
  { kind: "agent", id: "droid", label: "Droid", names: ["droid"] },
  { kind: "agent", id: "kiro", label: "Kiro CLI", names: ["kiro-cli"] },
];

const SERVERS: ReadonlyArray<ProgramPattern> = [
  {
    kind: "server",
    id: "next",
    label: "Next.js",
    names: ["next", "next-server", "next-router-worker"],
    packages: ["next"],
  },
  {
    kind: "server",
    id: "nuxt",
    label: "Nuxt",
    names: ["nuxt", "nuxi"],
    packages: ["nuxt", "nuxi"],
  },
  { kind: "server", id: "astro", label: "Astro", names: ["astro"], packages: ["astro"] },
  { kind: "server", id: "remix", label: "Remix", names: ["remix"], packages: ["@remix-run/dev"] },
  {
    kind: "server",
    id: "react-router",
    label: "React Router",
    names: ["react-router"],
    packages: ["@react-router/dev"],
  },
  {
    kind: "server",
    id: "storybook",
    label: "Storybook",
    names: ["storybook", "sb"],
    packages: ["storybook", "@storybook/cli"],
  },
  { kind: "server", id: "angular", label: "Angular", names: ["ng"], packages: ["@angular/cli"] },
  { kind: "server", id: "vue-cli", label: "Vue CLI", names: ["vue-cli-service"] },
  { kind: "server", id: "gatsby", label: "Gatsby", names: ["gatsby"] },
  { kind: "server", id: "docusaurus", label: "Docusaurus", names: ["docusaurus"] },
  { kind: "server", id: "expo", label: "Expo", names: ["expo"], packages: ["expo", "@expo/cli"] },
  { kind: "server", id: "metro", label: "Metro", names: ["metro", "react-native"] },
  {
    kind: "server",
    id: "wrangler",
    label: "Wrangler",
    names: ["wrangler", "workerd"],
    packages: ["wrangler"],
  },
  {
    kind: "server",
    id: "vite-plus",
    label: "Vite+",
    names: ["vp", "vite-plus"],
    packages: ["vite-plus"],
  },
  // Vite after the frameworks built on it, so Astro or Remix win over plain Vite.
  { kind: "server", id: "vite", label: "Vite", names: ["vite"], packages: ["vite"] },
  {
    kind: "server",
    id: "webpack",
    label: "webpack",
    names: ["webpack", "webpack-dev-server", "webpack-cli"],
  },
  { kind: "server", id: "rspack", label: "Rspack", names: ["rspack", "rsbuild"] },
  { kind: "server", id: "parcel", label: "Parcel", names: ["parcel"] },
  { kind: "server", id: "vitest", label: "Vitest", names: ["vitest"], packages: ["vitest"] },
  { kind: "server", id: "jest", label: "Jest", names: ["jest"] },
  {
    kind: "server",
    id: "playwright",
    label: "Playwright",
    names: ["playwright"],
    packages: ["playwright", "@playwright/test"],
  },
  { kind: "server", id: "tsc", label: "TypeScript", names: ["tsc"] },
  { kind: "server", id: "turbo", label: "Turborepo", names: ["turbo"] },
  { kind: "server", id: "nx", label: "Nx", names: ["nx"] },
  { kind: "server", id: "nodemon", label: "nodemon", names: ["nodemon"] },
  { kind: "server", id: "uvicorn", label: "Uvicorn", names: ["uvicorn"] },
  { kind: "server", id: "gunicorn", label: "Gunicorn", names: ["gunicorn"] },
  { kind: "server", id: "flask", label: "Flask", names: ["flask"] },
  { kind: "server", id: "rails", label: "Rails", names: ["rails", "puma"] },
  { kind: "server", id: "hugo", label: "Hugo", names: ["hugo"] },
  { kind: "server", id: "jekyll", label: "Jekyll", names: ["jekyll"] },
  { kind: "server", id: "ollama", label: "Ollama", names: ["ollama"] },
  { kind: "server", id: "cloudflared", label: "Cloudflare Tunnel", names: ["cloudflared"] },
];

const DATABASES: ReadonlyArray<ProgramPattern> = [
  { kind: "database", id: "postgres", label: "PostgreSQL", names: ["postgres", "postmaster"] },
  { kind: "database", id: "mysql", label: "MySQL", names: ["mysqld", "mariadbd"] },
  { kind: "database", id: "redis", label: "Redis", names: ["redis-server", "valkey-server"] },
  { kind: "database", id: "mongodb", label: "MongoDB", names: ["mongod"] },
];

// Runners whose next argument is the real program: `node /usr/local/bin/claude`.
const RUNNERS = new Set([
  "node",
  "bun",
  "deno",
  "python",
  "python3",
  "ruby",
  "php",
  "npx",
  "bunx",
  "uvx",
  "tsx",
  "ts-node",
]);

const RUNTIME_SERVERS: Readonly<Record<string, string>> = {
  node: "Node server",
  bun: "Bun server",
  deno: "Deno server",
  python: "Python server",
  python3: "Python server",
  ruby: "Ruby server",
  php: "PHP server",
  java: "Java server",
  dotnet: ".NET server",
};

const baseName = (word: string) =>
  word.slice(word.lastIndexOf("/") + 1).replace(/\.(c?m?[jt]s|exe|py|rb)$/, "");

/** The program a command runs: its executable, or the script a runner like `node` was given. */
function programOf(command: string): { readonly runner: string; readonly program: string } {
  const words = command.split(/\s+/).filter((word) => word.length > 0);
  // macOS runs `python3` as `…/Python.app/Contents/MacOS/Python`.
  const runner = baseName(words[0] ?? "")
    .replace(/^-/, "")
    .toLowerCase();
  if (!RUNNERS.has(runner)) return { runner, program: runner };
  // `node --inspect server.js`, `python -m http.server`: skip flags to the script or module.
  const moduleIndex = words.indexOf("-m");
  const script =
    moduleIndex > 0 ? words[moduleIndex + 1] : words.slice(1).find((word) => !word.startsWith("-"));
  return { runner, program: baseName(script ?? runner) };
}

const matches = (pattern: ProgramPattern, command: string, program: string) =>
  pattern.names.includes(program) ||
  (pattern.packages?.some(
    (name) =>
      command.includes(`/node_modules/${name}/`) ||
      command.startsWith(`${name}@`) ||
      command.includes(` ${name}@`),
  ) ??
    false);

const toProgram = (pattern: ProgramPattern): RecognizedProgram => ({
  kind: pattern.kind,
  id: pattern.id,
  label: pattern.label,
  driverKind: pattern.driverKind ?? null,
});

/**
 * Recognizes a process tree from every command in it, root first. An agent
 * anywhere wins (its tools run as its children), then a known framework or
 * database, then, for a tree that listens on a port, the runtime serving it.
 */
export function recognizeProgram(input: {
  readonly commands: ReadonlyArray<string>;
  readonly listeningCommands: ReadonlyArray<string>;
}): RecognizedProgram | null {
  const parsed = input.commands.map((command) => ({ command, ...programOf(command) }));
  for (const patterns of [AGENTS, SERVERS, DATABASES]) {
    for (const { command, program } of parsed) {
      const pattern = patterns.find((candidate) => matches(candidate, command, program));
      if (pattern) return toProgram(pattern);
    }
  }
  for (const command of input.listeningCommands) {
    const label = RUNTIME_SERVERS[programOf(command).runner];
    if (label) return { kind: "server", id: "runtime", label, driverKind: null };
  }
  return null;
}
