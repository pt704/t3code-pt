import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Running processes and project actions for one environment. */
export function createProcessesEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:processes:list",
      tag: WS_METHODS.processesSubscribe,
      // The server polls while anyone subscribes; stop as soon as the page closes.
      idleTtlMs: 0,
    }),
    actions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:processes:actions",
      tag: WS_METHODS.processesListActions,
      staleTimeMs: 30_000,
    }),
    stop: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:processes:stop",
      tag: WS_METHODS.processesStop,
    }),
    restart: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:processes:restart",
      tag: WS_METHODS.processesRestart,
    }),
    runAction: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:processes:run-action",
      tag: WS_METHODS.processesRunAction,
    }),
  };
}
