import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId, TrackedProcess } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";

/**
 * The thread a process belongs to: its terminal's thread, the thread whose
 * agent started the action, or the thread that owns the worktree it runs in.
 */
function processThreadId(entry: TrackedProcess): ThreadId | null {
  if (entry.origin === "action") return entry.startedBy?.threadId ?? null;
  return entry.threadIds[0] ?? null;
}

/** A link to the process's thread, or nothing when it has none. */
export function ProcessThreadLink(props: {
  environmentId: EnvironmentId;
  entry: TrackedProcess;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const threadShells = useThreadShells();
  const threadId = processThreadId(props.entry);
  if (threadId === null) return null;
  const thread = threadShells.find(
    (candidate) => candidate.environmentId === props.environmentId && candidate.id === threadId,
  );
  if (!thread) return null;
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline",
        props.compact && "max-w-40",
      )}
      onClick={(event) => {
        event.stopPropagation();
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(props.environmentId, threadId)),
        });
      }}
    >
      <MessageSquareIcon className="size-3 shrink-0" />
      <span className="truncate">{thread.title}</span>
    </button>
  );
}
