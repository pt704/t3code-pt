/**
 * Finds runnable commands a repository already declares, so the Processes
 * page can offer them as project actions without the user typing them in.
 */
import type { ProjectAction, ProjectScriptIcon } from "@t3tools/contracts";

const MAX_ACTIONS_PER_SOURCE = 40;

export function actionIcon(name: string): ProjectScriptIcon {
  const lower = name.toLowerCase();
  if (/(^|[:_-])(test|spec|e2e)/.test(lower)) return "test";
  if (/(^|[:_-])(lint|check|typecheck|fmt|format)/.test(lower)) return "lint";
  if (/(^|[:_-])(build|compile|bundle|dist)/.test(lower)) return "build";
  if (/(^|[:_-])(debug|inspect)/.test(lower)) return "debug";
  if (/(^|[:_-])(setup|install|bootstrap|configure|migrate)/.test(lower)) return "configure";
  return "play";
}

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** Picks the package manager from `packageManager` in package.json, then from the lockfile present. */
function detectPackageManager(
  packageJson: { readonly packageManager?: unknown },
  lockfiles: ReadonlySet<string>,
): PackageManager {
  if (typeof packageJson.packageManager === "string") {
    const name = packageJson.packageManager.split("@", 1)[0];
    if (name === "pnpm" || name === "yarn" || name === "bun" || name === "npm") return name;
  }
  if (lockfiles.has("bun.lock") || lockfiles.has("bun.lockb")) return "bun";
  if (lockfiles.has("pnpm-lock.yaml")) return "pnpm";
  if (lockfiles.has("yarn.lock")) return "yarn";
  return "npm";
}

export const PACKAGE_LOCKFILES = ["bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock"] as const;

export function packageJsonActions(
  content: string,
  lockfiles: ReadonlySet<string>,
): ReadonlyArray<ProjectAction> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const packageJson = parsed as { readonly scripts?: unknown; readonly packageManager?: unknown };
  if (typeof packageJson.scripts !== "object" || packageJson.scripts === null) return [];
  const manager = detectPackageManager(packageJson, lockfiles);
  const run = manager === "yarn" ? "yarn" : `${manager} run`;
  return Object.entries(packageJson.scripts)
    .filter(
      ([name, command]) =>
        typeof command === "string" &&
        command.trim().length > 0 &&
        // npm runs pre/post hooks itself; listing them separately is noise.
        !/^(pre|post)/.test(name) &&
        !["prepare", "prepublishOnly"].includes(name),
    )
    .slice(0, MAX_ACTIONS_PER_SOURCE)
    .map(([name]) => ({
      id: `package.json:${name}`,
      name,
      command: `${run} ${/^[\w:.-]+$/.test(name) ? name : JSON.stringify(name)}`,
      icon: actionIcon(name),
      source: "package.json" as const,
    }));
}

/** Explicit targets from a Makefile, skipping special, pattern and variable-assignment lines. */
export function makefileActions(content: string): ReadonlyArray<ProjectAction> {
  const names = new Set<string>();
  for (const line of content.split("\n")) {
    const match = /^([A-Za-z0-9][\w.-]*)\s*:(?![:=])/.exec(line);
    if (!match || match[1]!.includes("%")) continue;
    names.add(match[1]!);
    if (names.size >= MAX_ACTIONS_PER_SOURCE) break;
  }
  return [...names].map((name) => ({
    id: `Makefile:${name}`,
    name,
    command: `make ${name}`,
    icon: actionIcon(name),
    source: "Makefile" as const,
  }));
}

/** Process types from a Procfile (`web: bundle exec rails s`). */
export function procfileActions(content: string): ReadonlyArray<ProjectAction> {
  const actions: ProjectAction[] = [];
  for (const line of content.split("\n")) {
    const match = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(line.trim());
    if (!match) continue;
    actions.push({
      id: `Procfile:${match[1]}`,
      name: match[1]!,
      command: match[2]!.trim(),
      icon: actionIcon(match[1]!),
      source: "Procfile",
    });
    if (actions.length >= MAX_ACTIONS_PER_SOURCE) break;
  }
  return actions;
}

/** Drops discovered commands the project already saved as actions. */
export function withoutSaved(
  discovered: ReadonlyArray<ProjectAction>,
  saved: ReadonlyArray<ProjectAction>,
): ReadonlyArray<ProjectAction> {
  const savedCommands = new Set(saved.map((action) => action.command.trim()));
  return discovered.filter((action) => !savedCommands.has(action.command.trim()));
}
