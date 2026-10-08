import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentId,
  ProjectAction,
  ProjectActionRun,
  ProjectScriptIcon,
  TrackedProcess,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  BookmarkPlusIcon,
  ChevronRightIcon,
  HistoryIcon,
  PlayIcon,
  SparklesIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { resolveProjectScripts } from "@t3tools/shared/projectScripts";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { processesEnvironment } from "../../state/processes";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectFavicon } from "../ProjectFavicon";
import { ScriptIcon } from "../projectScriptEditor";
import { useProjectScriptSettings } from "../settings/useProjectScriptSettings";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Hint } from "./Hint";
import { folderName } from "./processesPage.logic";

const ICON_TONES: Record<ProjectScriptIcon, string> = {
  play: "bg-success/10 text-success",
  test: "bg-info/10 text-info",
  lint: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
  build: "bg-warning/10 text-warning-foreground",
  configure: "bg-muted text-muted-foreground",
  debug: "bg-destructive/10 text-destructive-foreground",
};

const EXPANDED_STORAGE_KEY = "t3code:processes:expanded-projects";
const ExpandedProjects = Schema.Record(Schema.String, Schema.Boolean);
const EXPANDED_DISCOVERED_STORAGE_KEY = "t3code:processes:expanded-discovered";
/** With only a few projects, show them all open; past that, open the busy ones. */
const EXPAND_ALL_UP_TO = 5;

export function ProjectActionsPane(props: {
  environmentId: EnvironmentId;
  processes: ReadonlyArray<TrackedProcess>;
  actionRuns: ReadonlyArray<ProjectActionRun>;
  onSelectProcess: (entry: TrackedProcess) => void;
  onSelectRun: (run: ProjectActionRun, title: string) => void;
}) {
  const allProjects = useProjects();
  const projects = useMemo(() => {
    const running = new Set(props.processes.map((entry) => entry.projectId));
    return allProjects
      .filter((project) => project.environmentId === props.environmentId)
      .toSorted((left, right) => Number(running.has(right.id)) - Number(running.has(left.id)));
  }, [allProjects, props.environmentId, props.processes]);
  const [expandedOverrides, setExpandedOverrides] = useLocalStorage(
    EXPANDED_STORAGE_KEY,
    {},
    ExpandedProjects,
  );

  if (projects.length === 0)
    return (
      <p className="px-6 py-8 text-sm text-muted-foreground">
        Add a project to see the commands you can run in it.
      </p>
    );

  return (
    <ScrollArea className="min-h-0 flex-1">
      {/* Capped so a row's buttons stay within reach of its name on wide screens. */}
      <div className="flex w-full max-w-3xl flex-col gap-1 px-4 pb-3">
        {projects.map((project) => {
          const key = `${props.environmentId}:${project.id}`;
          const running = props.processes.filter((entry) => entry.projectId === project.id);
          const expanded =
            expandedOverrides[key] ?? (projects.length <= EXPAND_ALL_UP_TO || running.length > 0);
          return (
            <section key={project.id} aria-label={project.title}>
              {/* Sticks while its section scrolls by, so you always know whose actions these are. */}
              <div className="sticky top-0 z-10 bg-background pt-2 pb-1">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpandedOverrides({ ...expandedOverrides, [key]: !expanded })}
                  className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left hover:bg-accent/60"
                >
                  <ChevronRightIcon
                    className={cn(
                      "-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150",
                      expanded && "rotate-90",
                    )}
                  />
                  <ProjectFavicon project={project} className="size-4 shrink-0" />
                  <span className="min-w-0 truncate text-sm font-medium text-foreground/90">
                    {project.title}
                  </span>
                  {running.length > 0 ? <RunningDot count={running.length} /> : null}
                </button>
              </div>
              {expanded ? (
                <ProjectActionsSection
                  environmentId={props.environmentId}
                  project={project}
                  processes={running}
                  actionRuns={props.actionRuns.filter((run) => run.projectId === project.id)}
                  onSelectProcess={props.onSelectProcess}
                  onSelectRun={props.onSelectRun}
                />
              ) : null}
            </section>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function RunningDot(props: { count: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-info">
      <span className="size-1.5 rounded-full bg-info" />
      {props.count} running
    </span>
  );
}

/** One project's actions in one checkout. Mounted only while expanded, so collapsed projects cost nothing. */
function ProjectActionsSection(props: {
  environmentId: EnvironmentId;
  project: EnvironmentProject;
  processes: ReadonlyArray<TrackedProcess>;
  actionRuns: ReadonlyArray<ProjectActionRun>;
  onSelectProcess: (entry: TrackedProcess) => void;
  onSelectRun: (run: ProjectActionRun, title: string) => void;
}) {
  const { environmentId, project } = props;
  const threadShells = useThreadShells();
  const workspaceRoots = useMemo(() => {
    const roots = new Set<string>([project.workspaceRoot]);
    for (const thread of threadShells)
      if (
        thread.environmentId === environmentId &&
        thread.projectId === project.id &&
        thread.worktreePath !== null
      )
        roots.add(thread.worktreePath);
    for (const entry of props.processes)
      if (entry.workspaceRoot !== null) roots.add(entry.workspaceRoot);
    return [...roots];
  }, [environmentId, project, props.processes, threadShells]);
  const [chosenRoot, setChosenRoot] = useState<string | null>(null);
  const discoveredKey = `${environmentId}:${project.id}`;
  const [expandedDiscovered, setExpandedDiscovered] = useLocalStorage(
    EXPANDED_DISCOVERED_STORAGE_KEY,
    {},
    ExpandedProjects,
  );
  const discoveredOpen = expandedDiscovered[discoveredKey] ?? false;
  const workspaceRoot =
    chosenRoot !== null && workspaceRoots.includes(chosenRoot) ? chosenRoot : project.workspaceRoot;
  const isRoot = workspaceRoot === project.workspaceRoot;

  const query = useEnvironmentQuery(
    processesEnvironment.actions({
      environmentId,
      input: { projectId: project.id, ...(isRoot ? {} : { workspaceRoot }) },
    }),
  );
  const runAction = useAtomCommand(processesEnvironment.runAction);
  const { environments } = useEnvironments();
  const serverConfig = environments.find(
    (entry) => entry.environmentId === environmentId,
  )?.serverConfig;
  // Saved actions are already in this client's settings, so they show at once;
  // only discovery has to wait for the server to read the repository.
  const savedFromSettings = useMemo(
    (): ReadonlyArray<ProjectAction> =>
      serverConfig
        ? resolveProjectScripts(serverConfig.settings, project).map((script) => ({
            id: script.id,
            name: script.name,
            command: script.command,
            icon: script.icon,
            source: "saved" as const,
          }))
        : [],
    [project, serverConfig],
  );
  const saved = query.data?.saved ?? savedFromSettings;
  const discovered = query.data?.discovered ?? null;
  const { saving, submit } = useProjectScriptSettings(
    serverConfig
      ? [
          {
            environmentId,
            settings: serverConfig.settings,
            keybindings: serverConfig.keybindings,
            project,
          },
        ]
      : [],
  );

  const run = async (action: ProjectAction) => {
    const result = await runAction({
      environmentId,
      input: { projectId: project.id, actionId: action.id, ...(isRoot ? {} : { workspaceRoot }) },
    });
    if (result._tag === "Success")
      props.onSelectRun(
        {
          projectId: project.id,
          actionId: action.id,
          workspaceRoot,
          terminal: result.value,
          running: true,
          updatedAt: new Date().toISOString(),
        },
        action.name,
      );
  };

  const save = async (action: ProjectAction) => {
    const result = await submit(null, {
      name: action.name,
      command: action.command,
      icon: action.icon,
      runOnWorktreeCreate: false,
      waitForSetup: false,
      runOnSettle: false,
      keybinding: null,
      previewUrl: null,
      autoOpenPreview: false,
    });
    if (result._tag === "Success") query.refresh();
  };

  const renderAction = (action: ProjectAction) => {
    const instances = props.processes.filter(
      (entry) => entry.actionId === action.id && entry.workspaceRoot === workspaceRoot,
    );
    const lastRun = props.actionRuns
      .filter((entry) => entry.actionId === action.id && entry.workspaceRoot === workspaceRoot)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const discovered = action.source !== "saved";
    return (
      <li
        key={action.id}
        className="group/action flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent/40"
      >
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md",
            ICON_TONES[action.icon],
          )}
        >
          <ScriptIcon icon={action.icon} className="size-3.5" />
        </span>
        <div className="flex min-w-0 shrink flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground/90">{action.name}</span>
            {discovered ? (
              <Badge variant="outline" size="sm">
                {action.source}
              </Badge>
            ) : (
              <Badge variant="success" size="sm">
                Saved
              </Badge>
            )}
          </div>
          <Hint label={action.command}>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {action.command}
            </span>
          </Hint>
        </div>
        {/* Status stays visible; the buttons sit right after the command and appear on
            hover or focus. Touch screens have no hover, so they always show there. */}
        <div className="flex shrink-0 items-center gap-1">
          {instances.length > 0 ? (
            <Hint label="Show its output">
              <button
                type="button"
                onClick={() => props.onSelectProcess(instances[0]!)}
                className="inline-flex h-6 cursor-pointer items-center rounded-md px-1.5 hover:bg-info/10"
              >
                <RunningDot count={instances.length} />
              </button>
            </Hint>
          ) : lastRun ? (
            <Hint label="Show the last run's output">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Show the last run's output"
                onClick={() => props.onSelectRun(lastRun, action.name)}
              >
                <HistoryIcon />
              </Button>
            </Hint>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover/action:opacity-100 pointer-fine:group-focus-within/action:opacity-100">
          {discovered ? (
            <Hint label="Save as a project action">
              <Button
                size="xs"
                variant="ghost"
                disabled={saving || !serverConfig}
                onClick={() => void save(action)}
              >
                <BookmarkPlusIcon />
                Save
              </Button>
            </Hint>
          ) : null}
          <Hint
            label={
              instances.length > 0
                ? `Starts another instance next to the ${instances.length} running`
                : `Run in ${isRoot ? "the project root" : folderName(workspaceRoot)}`
            }
          >
            <Button size="xs" variant="outline" onClick={() => void run(action)}>
              <PlayIcon className="text-success" />
              {instances.length > 0 ? "Run another" : "Run"}
            </Button>
          </Hint>
        </div>
      </li>
    );
  };

  // A collapsed list still says when one of its commands is running.
  const discoveredIds = new Set((discovered ?? []).map((action) => action.id));
  const discoveredRunning = props.processes.filter(
    (entry) =>
      entry.actionId !== null &&
      discoveredIds.has(entry.actionId) &&
      entry.workspaceRoot === workspaceRoot,
  ).length;

  return (
    <div className="flex flex-col gap-2 pt-1 pb-3 pl-6">
      {workspaceRoots.length > 1 ? (
        <Select value={workspaceRoot} onValueChange={(value) => setChosenRoot(value as string)}>
          <SelectTrigger
            aria-label="Checkout"
            size="compact"
            variant="ghost"
            className="w-auto self-start"
          >
            <SelectValue>{isRoot ? "Project root" : folderName(workspaceRoot)}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            {workspaceRoots.map((root) => (
              <SelectItem key={root} value={root}>
                {root === project.workspaceRoot ? "Project root" : folderName(root)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
      {query.error ? (
        <p className="px-2 text-sm text-destructive-foreground">{query.error}</p>
      ) : discovered !== null && saved.length === 0 && discovered.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">
          No actions here yet. Add one in the project's settings, or add scripts to its
          package.json, Makefile, Procfile or t3.json.
        </p>
      ) : (
        <>
          {saved.length > 0 ? <ul className="flex flex-col">{saved.map(renderAction)}</ul> : null}
          {discovered === null || discovered.length > 0 ? (
            <div className="flex flex-col gap-1">
              {/* Shown greyed out while discovery reads the repository, then fades in,
                  so loading never swaps in differently shaped content. */}
              <button
                type="button"
                aria-expanded={discoveredOpen}
                aria-busy={discovered === null}
                disabled={discovered === null}
                onClick={() =>
                  setExpandedDiscovered({ ...expandedDiscovered, [discoveredKey]: !discoveredOpen })
                }
                className={cn(
                  "flex h-7 cursor-pointer items-center gap-1.5 self-start rounded-md px-2 text-xs font-medium text-secondary-label transition-opacity duration-300 hover:bg-accent/60 hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-secondary-label",
                )}
              >
                <ChevronRightIcon
                  className={cn(
                    "-ml-0.5 size-3 shrink-0 text-muted-foreground/70 transition-transform duration-150",
                    discoveredOpen && discovered !== null && "rotate-90",
                  )}
                />
                <SparklesIcon
                  className={cn(
                    "size-3.5 transition-colors duration-300",
                    discovered === null ? "text-muted-foreground" : "text-info",
                  )}
                />
                Discovered in this checkout
                {discovered !== null ? (
                  <span className="text-muted-foreground tabular-nums">{discovered.length}</span>
                ) : null}
                {discoveredRunning > 0 ? <RunningDot count={discoveredRunning} /> : null}
              </button>
              {discoveredOpen && discovered !== null ? (
                <ul className="flex flex-col">{discovered.map(renderAction)}</ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
