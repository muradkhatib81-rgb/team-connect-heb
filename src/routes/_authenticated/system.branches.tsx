import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { SystemAdminPlaceholder } from "@/components/system-admin-placeholder";

export const Route = createFileRoute("/_authenticated/system/branches")({
  component: () => (
    <SystemAdminPlaceholder
      title="סניפים"
      icon={Building2}
      description="ניהול כלל סניפי הרשת — יצירה, עריכה, השבתה ומחיקה."
    />
  ),
});
