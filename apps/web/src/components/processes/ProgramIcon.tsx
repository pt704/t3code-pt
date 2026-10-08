import { ProviderDriverKind, type RecognizedProgram } from "@t3tools/contracts";
import type { CSSProperties } from "react";
import { BotIcon, DatabaseIcon, FlaskConicalIcon, HammerIcon, ServerIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { ProviderInstanceIcon, providerTextColor } from "../chat/ProviderInstanceIcon";

// Long-running tools that are not servers: watchers, test runners, builds.
const TEST_RUNNERS = new Set(["vitest", "jest", "playwright"]);
const BUILD_TOOLS = new Set(["tsc", "turbo", "nx", "webpack", "rspack", "parcel"]);

/** A recognized program's icon: an agent's brand icon, or a glyph for its kind. */
export function ProgramIcon(props: { program: RecognizedProgram; className?: string }) {
  const { program } = props;
  if (program.kind === "agent" && program.driverKind !== null)
    return (
      <ProviderInstanceIcon
        driverKind={ProviderDriverKind.make(program.driverKind)}
        displayName={program.label}
        showBadge={false}
        {...(props.className ? { iconClassName: props.className } : {})}
      />
    );
  const Glyph =
    program.kind === "agent"
      ? BotIcon
      : program.kind === "database"
        ? DatabaseIcon
        : TEST_RUNNERS.has(program.id)
          ? FlaskConicalIcon
          : BUILD_TOOLS.has(program.id)
            ? HammerIcon
            : ServerIcon;
  return <Glyph className={cn(props.className)} aria-hidden />;
}

/** The label color for a recognized program, matching how the app colors providers and states. */
export function programTextColor(program: RecognizedProgram): {
  readonly className?: string;
  readonly style?: CSSProperties;
} {
  if (program.kind === "agent") {
    const brand =
      program.driverKind === null
        ? {}
        : providerTextColor(ProviderDriverKind.make(program.driverKind));
    return brand.className ? brand : { className: "text-info" };
  }
  if (program.kind === "database") return { className: "text-warning-foreground" };
  if (TEST_RUNNERS.has(program.id)) return { className: "text-info" };
  return { className: "text-success" };
}
