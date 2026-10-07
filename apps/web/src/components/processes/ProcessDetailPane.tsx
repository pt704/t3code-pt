import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import {
  ThreadId,
  type EnvironmentId,
  type ProcessTerminalRef,
  type TrackedProcess,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import * as Schema from "effect/Schema";
import {
  ArrowLeftIcon,
  GitBranchIcon,
  GlobeIcon,
  RotateCwIcon,
  SquareIcon,
  UserIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "../../appearanceFonts";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { serverEnvironment } from "../../state/server";
import { TerminalViewport } from "../ThreadTerminalDrawer";
import { ProjectFavicon } from "../ProjectFavicon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Separator } from "../ui/separator";
import { Hint } from "./Hint";
import { folderName, formatElapsed, formatMemory, processTitle } from "./processesPage.logic";
import { ProcessThreadLink } from "./ProcessThreadLink";
import { originPresentation } from "./RunningProcessCard";

/** What the right column shows: a running process, or the output of a finished action run. */
export interface ProcessSelection {
  readonly processId: string | null;
  readonly terminal: ProcessTerminalRef | null;
  readonly title: string;
  readonly workspaceRoot: string | null;
}

function openUrl(url: string) {
  const localApi = readLocalApi();
  if (localApi) void localApi.shell.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function ProcessDetailPane(props: {
  environmentId: EnvironmentId;
  selection: ProcessSelection;
  /** The live process, or null once it has exited. */
  entry: TrackedProcess | null;
  project: EnvironmentProject | null;
  localPorts: boolean;
  now: number;
  pending: boolean;
  onBack: () => void;
  onStop: (entry: TrackedProcess) => void;
  onRestart: (entry: TrackedProcess) => void;
}) {
  const { entry, project, selection } = props;
  const origin = entry ? originPresentation(entry) : null;
  const OriginIcon = origin?.icon;
  const workspaceRoot = entry?.workspaceRoot ?? selection.workspaceRoot;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-2 px-4 pt-3 pb-2">
        <Hint
          label={
            <span className="flex items-center gap-1.5">
              Back to all actions <Kbd>Esc</Kbd>
            </span>
          }
        >
          <Button size="sm" variant="secondary" onClick={props.onBack}>
            <ArrowLeftIcon />
            All actions
          </Button>
        </Hint>
        <Separator orientation="vertical" className="mx-1 h-4!" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {entry ? processTitle(entry) : selection.title}
        </span>
        {origin && OriginIcon ? (
          <span
            className={cn("flex shrink-0 items-center gap-1 text-xs font-medium", origin.className)}
          >
            <OriginIcon className="size-3.5" />
            {origin.label}
          </span>
        ) : (
          <Badge variant="secondary" size="sm">
            Finished
          </Badge>
        )}
        {entry?.listeners.map((listener) =>
          props.localPorts ? (
            <Hint key={listener.port} label={`Open http://localhost:${listener.port}`}>
              <Button
                size="xs"
                variant="outline"
                onClick={() => openUrl(`http://localhost:${listener.port}`)}
              >
                <GlobeIcon />:{listener.port}
              </Button>
            </Hint>
          ) : (
            <Badge key={listener.port} variant="info" size="sm">
              :{listener.port}
            </Badge>
          ),
        )}
        {entry?.canRestart ? (
          <Button
            size="xs"
            variant="outline"
            disabled={props.pending}
            onClick={() => props.onRestart(entry)}
          >
            <RotateCwIcon />
            Restart
          </Button>
        ) : null}
        {entry ? (
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={props.pending}
            onClick={() => props.onStop(entry)}
          >
            <SquareIcon />
            Stop
          </Button>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-5 pb-3 text-xs text-secondary-label">
        {project ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <ProjectFavicon project={project} className="size-3.5 shrink-0" />
            <span className="truncate">{project.title}</span>
          </span>
        ) : null}
        {workspaceRoot && workspaceRoot !== project?.workspaceRoot ? (
          <Hint label={workspaceRoot}>
            <span className="truncate">{folderName(workspaceRoot)}</span>
          </Hint>
        ) : null}
        {entry?.branch ? (
          <span className="flex items-center gap-1">
            <GitBranchIcon className="size-3" />
            {entry.branch}
          </span>
        ) : null}
        {entry ? (
          <>
            <span className="tabular-nums">pid {entry.pid}</span>
            <span className="tabular-nums">up {formatElapsed(entry.startedAt, props.now)}</span>
            <span className="tabular-nums">{entry.cpuPercent.toFixed(0)}% CPU</span>
            <span className="tabular-nums">{formatMemory(entry.memoryBytes)}</span>
            {entry.startedBy?.kind === "user" ? (
              <span className="flex items-center gap-1">
                <UserIcon className="size-3" />
                Started by you
              </span>
            ) : null}
            <ProcessThreadLink environmentId={props.environmentId} entry={entry} />
          </>
        ) : null}
      </div>
      {selection.terminal ? (
        <ProcessOutput
          environmentId={props.environmentId}
          terminal={selection.terminal}
          cwd={workspaceRoot ?? entry?.cwd ?? "/"}
          title={selection.title}
        />
      ) : entry ? (
        <div className="flex flex-col gap-3 px-5 pb-5">
          <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap text-foreground/90">
            {entry.command}
          </pre>
          {entry.cwd ? (
            <p className="text-xs text-muted-foreground">
              Running in <span className="font-mono">{entry.cwd}</span>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            This process was not started in a T3 terminal, so its output is not available here.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Live terminal output, filling the rest of the pane. It attaches to the
 * existing session, so opening it never restarts the command.
 */
function ProcessOutput(props: {
  environmentId: EnvironmentId;
  terminal: ProcessTerminalRef;
  cwd: string;
  title: string;
}) {
  const [advancedTypography] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  const threadId = ThreadId.make(props.terminal.threadId);
  const threadRef = useMemo(
    () => scopeThreadRef(props.environmentId, threadId),
    [props.environmentId, threadId],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(Math.round(entry.contentRect.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={containerRef} className="min-h-0 flex-1 border-t border-border/50">
      <TerminalViewport
        key={`${props.terminal.threadId}\u0000${props.terminal.terminalId}`}
        threadRef={threadRef}
        threadId={threadId}
        terminalId={props.terminal.terminalId}
        terminalLabel={props.title}
        cwd={props.cwd}
        advancedTypography={advancedTypography}
        onSessionExited={() => undefined}
        focusRequestId={0}
        autoFocus={false}
        visible
        resizeEpoch={0}
        drawerHeight={height}
        keybindings={serverConfig?.keybindings ?? DEFAULT_RESOLVED_KEYBINDINGS}
      />
    </div>
  );
}
