import { createFileRoute } from "@tanstack/react-router";
import { PermissionsPage } from "@/routes/_authenticated/permissions";

export const Route = createFileRoute("/_authenticated/system/permissions")({
  component: PermissionsPage,
});
