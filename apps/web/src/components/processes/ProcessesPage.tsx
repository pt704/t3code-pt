import { autoAnimate } from "@formkit/auto-animate";
import type { EnvironmentId, ProjectActionRun, TrackedProcess } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ActivityIcon, ChevronRightIcon, ServerIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { processesEnvironment } from "../../state/processes";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ProcessDetailPane, type ProcessSelection } from "./ProcessDetailPane";
import { processTitle, sortRunningProcesses } from "./processesPage.logic";
import { ProgramIcon } from "./ProgramIcon";
import { ProjectActionsPane } from "./ProjectActionsPane";
import { RunningProcessCard } from "./RunningProcessCard";

const EXTERNAL_EXPANDED_STORAGE_KEY = "t3code:processes:external-expanded";

// The same enter, leave and reorder motion as the sidebar's thread lists.
const LIST_ANIMATION_OPTIONS = { duration: 180, easing: "ease-out" } as const;
const animatedLists = new WeakSet<HTMLElement>();
function attachListAnimation(node: HTMLUListElement | null) {
  if (!node || animatedLists.has(node)) return;
  autoAnimate(node, LIST_ANIMATION_OPTIONS);
  animatedLists.add(node);
}

/** Elapsed labels only need minute precision; a slow tick avoids needless renders. */
function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const selectionForProcess = (entry: TrackedProcess): ProcessSelection => ({
  processId: entry.id,
  terminal: entry.terminal,
  title: processTitle(entry),
  workspaceRoot: entry.workspaceRoot,
});

/**
 * Running processes on the left, project actions on the right. Selecting a
 * process (or running an action) swaps the right column for its output.
 */
export function ProcessesPage() {
  const [selection, setSelection] = useState<ProcessSelection | null>(null);
  useEscapeToGoBack(selection ? () => setSelection(null) : undefined);
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const supported = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" &&
      environment.serverConfig?.environment?.capabilities.processes === true,
  );
  const [chosenEnvironmentId, setChosenEnvironmentId] = useState<EnvironmentId | null>(null);
  const environmentId =
    supported.find((environment) => environment.environmentId === chosenEnvironmentId)
      ?.environmentId ??
    supported.find((environment) => environment.environmentId === primaryEnvironmentId)
      ?.environmentId ??
    supported[0]?.environmentId ??
    null;
  const environment = supported.find((entry) => entry.environmentId === environmentId) ?? null;
  const query = useEnvironmentQuery(
    environmentId === null ? null : processesEnvironment.list({ environmentId, input: {} }),
  );
  const processes = useMemo(() => sortRunningProcesses(query.data?.processes ?? []), [query.data]);
  // Processes T3 Code started come first; anything started elsewhere folds
  // into its own section, collapsed until asked for.
  const startedInT3 = processes.filter((entry) => entry.origin !== "external");
  const external = processes.filter((entry) => entry.origin === "external");
  // The collapsed header still says which agents and servers are in there.
  const externalPrograms = external.flatMap((entry) => (entry.program ? [entry.program] : []));
  const externalAgentPrograms = externalPrograms.filter((program) => program.kind === "agent");
  const externalAgents = [
    ...new Map(externalAgentPrograms.map((program) => [program.id, program])).values(),
  ];
  const externalServerCount = externalPrograms.length - externalAgentPrograms.length;
  const [externalOpen, setExternalOpen] = useLocalStorage(
    EXTERNAL_EXPANDED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const allProjects = useProjects();
  const projectFor = (projectId: string | null) =>
    allProjects.find(
      (project) => project.environmentId === environmentId && project.id === projectId,
    ) ?? null;
  const now = useNow();

  const stop = useAtomCommand(processesEnvironment.stop);
  const restart = useAtomCommand(processesEnvironment.restart);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const runOnProcess = async (entry: TrackedProcess, kind: "stop" | "restart") => {
    if (environmentId === null) return;
    if (kind === "stop" && entry.origin === "external") {
      const confirmed = await readLocalApi()?.dialogs.confirm(
        `Stop ${entry.name}?\nIt was started outside T3 Code (pid ${entry.pid}). T3 Code sends SIGTERM, then SIGKILL if it does not exit.`,
        { variant: "destructive" },
      );
      if (confirmed === false) return;
    }
    setPendingIds((current) => new Set(current).add(entry.id));
    await (kind === "stop" ? stop : restart)({ environmentId, input: { processId: entry.id } });
    setPendingIds((current) => {
      const next = new Set(current);
      next.delete(entry.id);
      return next;
    });
  };

  // The selected process as it is now: by id, or by terminal for a run that
  // has just started (or restarted under a new pid).
  const selectedEntry =
    selection === null
      ? null
      : (processes.find((entry) => entry.id === selection.processId) ??
        (selection.terminal
          ? processes.find(
              (entry) =>
                entry.terminal?.threadId === selection.terminal?.threadId &&
                entry.terminal?.terminalId === selection.terminal?.terminalId,
            )
          : undefined) ??
        null);
  const selectRun = (run: ProjectActionRun, title: string) =>
    setSelection({
      processId: null,
      terminal: run.terminal,
      title,
      workspaceRoot: run.workspaceRoot,
    });

  const topbar = (
    <div className="flex w-full min-w-0 items-center gap-3 py-2">
      <WorkspaceBreadcrumb ariaLabel="Processes breadcrumb" className="min-w-0">
        <WorkspaceBreadcrumbItem>
          <h1>Processes</h1>
        </WorkspaceBreadcrumbItem>
        {supported.length > 1 ? (
          <>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem current className="min-w-10">
              <Select
                value={environmentId ?? ""}
                onValueChange={(value) => {
                  setChosenEnvironmentId(value as EnvironmentId);
                  setSelection(null);
                }}
              >
                <SelectTrigger
                  aria-label="Environment"
                  size="compact"
                  variant="ghost"
                  className="w-auto min-w-0"
                >
                  <SelectValue>{environment?.label}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="start" alignItemWithTrigger={false}>
                  {supported.map((entry) => (
                    <SelectItem key={entry.environmentId} value={entry.environmentId}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </WorkspaceBreadcrumbItem>
          </>
        ) : null}
      </WorkspaceBreadcrumb>
    </div>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron} className="h-auto">
          {topbar}
        </WorkspacePageHeader>
        {environmentId === null ? (
          <p className="px-6 py-8 text-sm text-muted-foreground">
            {environments.length === 0
              ? "Connect an environment to see its processes."
              : "None of your connected environments can track processes yet. Update T3 Code on the host."}
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <aside
              aria-label="Running processes"
              className="flex min-h-0 shrink-0 flex-col border-b border-border/50 max-md:h-2/5 md:w-104 md:border-r md:border-b-0"
            >
              <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                <h2 className="text-xs font-medium text-secondary-label">Running</h2>
                {query.data ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {startedInT3.length}
                  </span>
                ) : null}
              </div>
              <ScrollArea className="min-h-0 flex-1">
                {query.error ? (
                  <p className="px-4 py-2 text-sm text-destructive-foreground">{query.error}</p>
                ) : query.data === null ? null : (
                  <>
                    {processes.length === 0 ? (
                      <Empty size="compact">
                        <EmptyHeader>
                          <EmptyMedia>
                            <ActivityIcon />
                          </EmptyMedia>
                          <EmptyTitle>Nothing running</EmptyTitle>
                          <EmptyDescription>
                            Dev servers, watchers and long builds show up here, whether they started
                            in a T3 terminal, from an agent, or in another app.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : null}
                    {/* Stays mounted while empty so the first process to start animates in too. */}
                    <ul ref={attachListAnimation} className="px-2 pb-1">
                      {startedInT3.map((entry) => (
                        <RunningProcessCard
                          key={entry.id}
                          environmentId={environmentId}
                          entry={entry}
                          project={projectFor(entry.projectId)}
                          selected={selectedEntry?.id === entry.id}
                          now={now}
                          pending={pendingIds.has(entry.id)}
                          onSelect={() => setSelection(selectionForProcess(entry))}
                          onStop={() => void runOnProcess(entry, "stop")}
                          onRestart={() => void runOnProcess(entry, "restart")}
                        />
                      ))}
                    </ul>
                    {external.length > 0 ? (
                      <div className="px-2 pb-3">
                        <button
                          type="button"
                          aria-expanded={externalOpen}
                          onClick={() => setExternalOpen(!externalOpen)}
                          className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-secondary-label hover:bg-accent/60 hover:text-foreground"
                        >
                          <ChevronRightIcon
                            className={cn(
                              "-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150",
                              externalOpen && "rotate-90",
                            )}
                          />
                          External
                          <span className="text-muted-foreground tabular-nums">
                            {external.length}
                          </span>
                          <span className="ml-auto flex items-center gap-2.5">
                            {externalAgents.length > 0 ? (
                              <span className="flex items-center gap-1.5 text-info">
                                <span className="flex items-center -space-x-0.5">
                                  {externalAgents.slice(0, 4).map((program) => (
                                    <ProgramIcon
                                      key={program.id}
                                      program={program}
                                      className="size-3.5"
                                    />
                                  ))}
                                </span>
                                {externalAgentPrograms.length === 1
                                  ? "1 agent"
                                  : `${externalAgentPrograms.length} agents`}
                              </span>
                            ) : null}
                            {externalServerCount > 0 ? (
                              <span className="flex items-center gap-1 text-success">
                                <ServerIcon className="size-3.5" />
                                {externalServerCount === 1
                                  ? "1 server"
                                  : `${externalServerCount} servers`}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        {externalOpen ? (
                          <ul ref={attachListAnimation}>
                            {external.map((entry) => (
                              <RunningProcessCard
                                key={entry.id}
                                environmentId={environmentId}
                                entry={entry}
                                project={projectFor(entry.projectId)}
                                selected={selectedEntry?.id === entry.id}
                                now={now}
                                pending={pendingIds.has(entry.id)}
                                onSelect={() => setSelection(selectionForProcess(entry))}
                                onStop={() => void runOnProcess(entry, "stop")}
                                onRestart={() => void runOnProcess(entry, "restart")}
                              />
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
                {query.data && !query.data.externalDiscovery ? (
                  <p className="px-4 pb-3 text-xs text-muted-foreground">
                    This host only reports commands in T3 terminals.
                  </p>
                ) : null}
              </ScrollArea>
            </aside>
            <section aria-label="Project actions" className="flex min-h-0 min-w-0 flex-1 flex-col">
              {selection ? (
                <ProcessDetailPane
                  environmentId={environmentId}
                  selection={selection}
                  entry={selectedEntry}
                  project={projectFor(
                    selectedEntry?.projectId ??
                      (selection.terminal?.threadId.startsWith("project-actions:")
                        ? selection.terminal.threadId.slice("project-actions:".length)
                        : null),
                  )}
                  localPorts={environmentId === primaryEnvironmentId}
                  now={now}
                  pending={selectedEntry !== null && pendingIds.has(selectedEntry.id)}
                  onBack={() => setSelection(null)}
                  onStop={(entry) => void runOnProcess(entry, "stop")}
                  onRestart={(entry) => void runOnProcess(entry, "restart")}
                />
              ) : (
                <ProjectActionsPane
                  environmentId={environmentId}
                  processes={processes}
                  actionRuns={query.data?.actionRuns ?? []}
                  onSelectProcess={(entry) => setSelection(selectionForProcess(entry))}
                  onSelectRun={selectRun}
                />
              )}
            </section>
          </div>
        )}
      </div>
    </SidebarInset>
  );
}
