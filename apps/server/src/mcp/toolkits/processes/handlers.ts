import { OrchestratorMcpFailure, type ProcessesError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as ProcessTracker from "../../../processes/ProcessTracker.ts";
import { ProcessesToolkit } from "./tools.ts";

const toFailure = (error: ProcessesError) =>
  new OrchestratorMcpFailure({
    code: error._tag === "ProcessOperationError" ? "orchestration_error" : "invalid_request",
    message: error.message,
  });

const tracker = Effect.gen(function* () {
  const context = yield* McpInvocationContext.McpInvocationContext;
  if (!context.capabilities.has("orchestration"))
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This credential cannot inspect or manage processes.",
    });
  return yield* ProcessTracker.ProcessTracker;
});

export const layer = McpToolAccess.toLayer(ProcessesToolkit, {
  t3_process_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const current = yield* (yield* tracker).list.pipe(Effect.mapError(toFailure));
      return input.projectId === undefined
        ? current
        : {
            ...current,
            processes: current.processes.filter((entry) => entry.projectId === input.projectId),
            actionRuns: current.actionRuns.filter((run) => run.projectId === input.projectId),
          };
    }),
  ),
  t3_process_stop: McpToolAccess.writes((input) =>
    tracker.pipe(Effect.flatMap((service) => service.stop(input).pipe(Effect.mapError(toFailure)))),
  ),
  t3_process_restart: McpToolAccess.writes((input) =>
    tracker.pipe(
      Effect.flatMap((service) => service.restart(input).pipe(Effect.mapError(toFailure))),
    ),
  ),
  t3_project_actions_list: McpToolAccess.reads((input) =>
    tracker.pipe(
      Effect.flatMap((service) => service.listActions(input).pipe(Effect.mapError(toFailure))),
    ),
  ),
  t3_project_action_run: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const service = yield* tracker;
      const context = yield* McpInvocationContext.McpInvocationContext;
      return yield* service
        .runAction(input, { kind: "agent", threadId: context.thread?.threadId ?? null })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
});
