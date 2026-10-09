import {
  MAX_SCRIPT_ID_LENGTH,
  type ProjectId,
  type ProjectScript,
  type ServerSettings,
} from "@t3tools/contracts";

type ProjectScriptSettings = Pick<
  ServerSettings,
  | "defaultProjectScripts"
  | "projectScriptOverrides"
  | "projectSettingsOverrides"
  | "projectSettingsFolded"
>;

/**
 * The project's override wins, then environment defaults. Until the legacy
 * fields have been folded into `projectSettingsOverrides`, the old map (null
 * there meant "reset to machine defaults") and the aggregate's own scripts
 * still count, so a server that has not run the fold yet behaves as before.
 */
export function resolveProjectScripts(
  settings: ProjectScriptSettings,
  project: { id: ProjectId; scripts: readonly ProjectScript[] },
): readonly ProjectScript[] {
  const override = settings.projectSettingsOverrides[project.id]?.defaultProjectScripts;
  if (override !== undefined) return override;
  if (settings.projectSettingsFolded) return settings.defaultProjectScripts;
  const legacy = settings.projectScriptOverrides[project.id];
  if (legacy === null) return settings.defaultProjectScripts;
  return legacy ?? (project.scripts.length > 0 ? project.scripts : settings.defaultProjectScripts);
}

export function projectScriptsInheritDefaults(
  settings: ProjectScriptSettings,
  project: { id: ProjectId; scripts: readonly ProjectScript[] },
): boolean {
  if (settings.projectSettingsOverrides[project.id]?.defaultProjectScripts !== undefined) {
    return false;
  }
  if (settings.projectSettingsFolded) return true;
  const legacy = settings.projectScriptOverrides[project.id];
  return legacy === null || (legacy === undefined && project.scripts.length === 0);
}

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    T3CODE_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.T3CODE_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}

/** Menu label naming the lifecycle roles a script runs in, e.g. "Clean (on settle)". */
export function projectScriptMenuLabel(script: ProjectScript): string {
  const roles = [
    ...(script.runOnWorktreeCreate ? ["setup"] : []),
    ...(script.runOnSettle ? ["on settle"] : []),
  ];
  return roles.length === 0 ? script.name : `${script.name} (${roles.join(", ")})`;
}

export function settleProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnSettle === true) ?? null;
}

function normalizeScriptId(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) {
    return "script";
  }
  if (cleaned.length <= MAX_SCRIPT_ID_LENGTH) {
    return cleaned;
  }
  return cleaned.slice(0, MAX_SCRIPT_ID_LENGTH).replace(/-+$/g, "") || "script";
}

/** A free id for a new action named `name`, e.g. "run-tests" or "run-tests-2". */
export function nextProjectScriptId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(Array.from(existingIds));
  const baseId = normalizeScriptId(name);
  if (!taken.has(baseId)) return baseId;

  // Ends: only finitely many ids are taken.
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${baseId}-${suffix}`;
    const safeCandidate =
      candidate.length <= MAX_SCRIPT_ID_LENGTH
        ? candidate
        : `${baseId.slice(0, Math.max(1, MAX_SCRIPT_ID_LENGTH - String(suffix).length - 1))}-${suffix}`;
    if (!taken.has(safeCandidate)) return safeCandidate;
  }
}
