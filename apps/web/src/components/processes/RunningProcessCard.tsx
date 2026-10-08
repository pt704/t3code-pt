import type { EnvironmentId, TrackedProcess } from "@t3tools/contracts";
import {
  AppWindowIcon,
  BotIcon,
  CircleAlertIcon,
  GitBranchIcon,
  PlayIcon,
  RotateCwIcon,
  SquareIcon,
  SquareTerminalIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { ProjectFavicon } from "../ProjectFavicon";
import { Hint } from "./Hint";
import { formatElapsed, isQuietProcess, processTitle } from "./processesPage.logic";
import { ProgramIcon, programTextColor } from "./ProgramIcon";
import { ProcessThreadLink } from "./ProcessThreadLink";

interface OriginPresentation {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly className: string;
}

/** How a process got started, in the inbox's status-slot colors. */
export function originPresentation(entry: TrackedProcess): OriginPresentation {
  switch (entry.origin) {
    case "action":
      return entry.startedBy?.kind === "agent"
        ? { icon: BotIcon, label: "Agent action", className: "text-info" }
        : { icon: PlayIcon, label: "Action", className: "text-success" };
    case "terminal":
      return { icon: TerminalIcon, label: "Terminal", className: "text-foreground/70" };
    case "agent":
      return { icon: BotIcon, label: "Agent", className: "text-info" };
    case "external":
      return { icon: SquareTerminalIcon, label: "External", className: "text-muted-foreground" };
  }
}

/**
 * One running process, laid out like an inbox card: project on top, the
 * command as the title, then branch, ports and the thread it belongs to.
 * Stop and restart replace the status on hover.
 */
export function RunningProcessCard(props: {
  environmentId: EnvironmentId;
  entry: TrackedProcess;
  project: EnvironmentProject | null;
  selected: boolean;
  now: number;
  pending: boolean;
  onSelect: () => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  const { entry, project } = props;
  const origin = originPresentation(entry);
  const quiet = isQuietProcess(entry, props.now);
  // The status names what runs (Claude Code, Vite, PostgreSQL…); who started
  // it moves to a small icon on the bottom line. Unrecognized processes keep
  // their origin as the status.
  const program = quiet ? null : entry.program;
  const StatusIcon = quiet ? CircleAlertIcon : origin.icon;
  const OriginIcon = origin.icon;
  const programColor = program ? programTextColor(program) : null;
  return (
    <li className="list-none py-0.5">
      <div
        role="button"
        tabIndex={0}
        aria-pressed={props.selected}
        onClick={props.onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            props.onSelect();
          }
        }}
        className={cn(
          "group/process-card relative w-full cursor-pointer rounded-md text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          props.selected ? "bg-accent text-foreground" : "hover:bg-accent/60",
        )}
      >
        <div className="px-2.5 py-2">
          <div className="flex h-5 min-w-0 items-center gap-1.5">
            {project ? <ProjectFavicon project={project} className="size-4 shrink-0" /> : null}
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-secondary-label">
              {project?.title ?? "Outside your projects"}
            </span>
            <span
              className={cn(
                "flex shrink-0 items-center gap-1 text-xs font-medium transition-opacity group-hover/process-card:opacity-0 group-focus-within/process-card:opacity-0",
                quiet ? "text-warning" : (programColor?.className ?? origin.className),
              )}
              style={programColor?.style}
            >
              {program ? (
                <ProgramIcon program={program} className="size-3.5" />
              ) : (
                <StatusIcon className="size-3.5" />
              )}
              {quiet
                ? `Quiet ${formatElapsed(entry.lastOutputAt ?? entry.startedAt, props.now)}`
                : (program?.label ?? origin.label)}
            </span>
            <span className="pointer-events-none absolute top-1.5 right-1.5 flex items-center opacity-0 transition-opacity group-hover/process-card:pointer-events-auto group-hover/process-card:opacity-100 group-focus-within/process-card:pointer-events-auto group-focus-within/process-card:opacity-100">
              {entry.canRestart ? (
                <CardAction
                  label="Restart"
                  disabled={props.pending}
                  onClick={props.onRestart}
                  icon={RotateCwIcon}
                />
              ) : null}
              <CardAction
                label="Stop"
                disabled={props.pending}
                onClick={props.onStop}
                icon={SquareIcon}
                destructive
              />
            </span>
          </div>
          <div className="mt-1 flex min-w-0">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm font-medium text-foreground/90",
                entry.actionId === null && "font-mono text-xs leading-5",
              )}
            >
              {processTitle(entry)}
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-secondary-label">
            {entry.program !== null || quiet ? (
              <Hint label={origin.label}>
                <span className={cn("flex shrink-0 items-center", origin.className)}>
                  <OriginIcon className="size-3" aria-label={origin.label} />
                </span>
              </Hint>
            ) : null}
            {entry.branch ? (
              <span className="flex min-w-0 items-center gap-1 text-muted-foreground/70">
                <GitBranchIcon className="size-3 shrink-0" />
                <span className="truncate">{entry.branch}</span>
              </span>
            ) : null}
            {entry.listeners.map((listener) => (
              <span key={listener.port} className="shrink-0 font-mono text-info tabular-nums">
                :{listener.port}
              </span>
            ))}
            <span className="shrink-0 tabular-nums">
              {formatElapsed(entry.startedAt, props.now)}
            </span>
            <span className="ml-auto flex min-w-0 items-center gap-1.5">
              {entry.hostApp ? (
                <Hint label={`Running in ${entry.hostApp}`}>
                  <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                    <AppWindowIcon className="size-3 shrink-0" />
                    <span className="max-w-32 truncate">{entry.hostApp}</span>
                  </span>
                </Hint>
              ) : null}
              <ProcessThreadLink environmentId={props.environmentId} entry={entry} compact />
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

function CardAction(props: {
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <Hint label={props.label}>
      <button
        type="button"
        aria-label={props.label}
        disabled={props.disabled}
        onClick={(event) => {
          event.stopPropagation();
          props.onClick();
        }}
        className={cn(
          "inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-background/80 disabled:cursor-default disabled:opacity-50",
          props.destructive ? "hover:text-destructive-foreground" : "hover:text-foreground",
        )}
      >
        <Icon className="size-3.5" />
      </button>
    </Hint>
  );
}
