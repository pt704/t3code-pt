import { createProcessesEnvironmentAtoms } from "@t3tools/client-runtime/state/processes";

import { connectionAtomRuntime } from "../connection/runtime";

export const processesEnvironment = createProcessesEnvironmentAtoms(connectionAtomRuntime);
