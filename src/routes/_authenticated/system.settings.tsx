import { createFileRoute } from "@tanstack/react-router";
import { CompanySettingsPage } from "@/routes/_authenticated/company-settings";

export const Route = createFileRoute("/_authenticated/system/settings")({
  component: CompanySettingsPage,
});
