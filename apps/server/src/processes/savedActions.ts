/**
 * Edits to a project's saved actions, the same list the Processes page and
 * Settings > Actions show.
 */
import type { ProjectActionSaveInput, ProjectScript } from "@t3tools/contracts";
import { nextProjectScriptId } from "@t3tools/shared/projectScripts";

import { actionIcon } from "./actionDiscovery.ts";

/**
 * Adds an action, or replaces the saved one named by `actionId` while keeping
 * its setup, settle and preview settings. Null when `actionId` is not saved.
 * New ids avoid `takenIds`, since shortcuts address actions by id.
 */
export function upsertSavedAction(
  scripts: ReadonlyArray<ProjectScript>,
  input: ProjectActionSaveInput,
  takenIds: Iterable<string>,
): { readonly scripts: ReadonlyArray<ProjectScript>; readonly action: ProjectScript } | null {
  const icon = input.icon ?? actionIcon(input.name);
  if (input.actionId === undefined) {
    const action: ProjectScript = {
      id: nextProjectScriptId(input.name, takenIds),
      name: input.name,
      command: input.command,
      icon,
      runOnWorktreeCreate: false,
    };
    return { scripts: [...scripts, action], action };
  }
  const existing = scripts.find((script) => script.id === input.actionId);
  if (existing === undefined) return null;
  const action: ProjectScript = { ...existing, name: input.name, command: input.command, icon };
  return {
    scripts: scripts.map((script) => (script.id === existing.id ? action : script)),
    action,
  };
}
