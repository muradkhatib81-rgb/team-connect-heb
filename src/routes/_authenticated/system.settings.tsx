import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { SystemAdminPlaceholder } from "@/components/system-admin-placeholder";

export const Route = createFileRoute("/_authenticated/system/settings")({
  component: () => (
    <SystemAdminPlaceholder
      title="הגדרות מערכת"
      icon={Settings}
      description="הגדרות גלובליות, מודולים, אינטגרציות ותחזוקה ברמת המערכת."
    />
  ),
});
