import { createFileRoute } from "@tanstack/react-router";

import { ProcessesPage } from "../components/processes/ProcessesPage";

export const Route = createFileRoute("/processes")({
  component: ProcessesPage,
});
