import {
  OrchestratorMcpFailure,
  ProcessTerminalRef,
  ProjectActionList,
  ProjectActionListInput,
  ProjectActionRunInput,
  ProjectId,
  TrackedProcessInput,
  TrackedProcessList,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProcessTracker from "../../../processes/ProcessTracker.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  // ThreadManagementService backs the caller checks in McpToolAccess.writes.
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProcessTracker.ProcessTracker,
  ],
};

const ProcessListTool = Tool.make("t3_process_list", {
  ...shared,
  description:
    "List long-running processes on this machine: commands in T3 terminals, project actions, agent background shells, and processes started outside T3 Code that run in a project folder or listen on a port. Each entry has its project, worktree, branch, listening ports, CPU and memory. Use the id with t3_process_stop or t3_process_restart.",
  parameters: Schema.Struct({
    projectId: Schema.optional(
      ProjectId.annotate({ description: "Only list processes running in this project." }),
    ),
  }),
  success: TrackedProcessList,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ProcessStopTool = Tool.make("t3_process_stop", {
  ...shared,
  description:
    "Stop a process from t3_process_list and everything it started. Terminal commands get Ctrl-C first, then SIGTERM and SIGKILL if they do not exit.",
  parameters: TrackedProcessInput,
}).annotate(Tool.Destructive, true);

const ProcessRestartTool = Tool.make("t3_process_restart", {
  ...shared,
  description:
    "Stop a project action from t3_process_list and run its command again in the same terminal. Only processes with canRestart can be restarted.",
  parameters: TrackedProcessInput,
}).annotate(Tool.Destructive, true);

const ProjectActionsListTool = Tool.make("t3_project_actions_list", {
  ...shared,
  description:
    "List a project's runnable actions: saved project actions plus commands discovered in t3.json, package.json scripts, a Makefile or a Procfile.",
  parameters: ProjectActionListInput,
  success: ProjectActionList,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ProjectActionRunTool = Tool.make("t3_project_action_run", {
  ...shared,
  description:
    "Run a project action from t3_project_actions_list in its own T3 terminal, in the project root or one of its worktrees, so the user can see and stop it from the Processes page. If the action is already running there, this starts another instance; check t3_process_list first when one is enough.",
  parameters: ProjectActionRunInput,
  success: ProcessTerminalRef,
}).annotate(Tool.Destructive, false);

export const ProcessesToolkit = Toolkit.make(
  ProcessListTool,
  ProcessStopTool,
  ProcessRestartTool,
  ProjectActionsListTool,
  ProjectActionRunTool,
);
