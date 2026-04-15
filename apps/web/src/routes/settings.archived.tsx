import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/archived")({
  beforeLoad: () => {
    throw redirect({ to: "/archived", replace: true });
  },
});
