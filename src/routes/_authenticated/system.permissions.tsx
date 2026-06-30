import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { SystemAdminPlaceholder } from "@/components/system-admin-placeholder";

export const Route = createFileRoute("/_authenticated/system/permissions")({
  component: () => (
    <SystemAdminPlaceholder
      title="הרשאות מערכת"
      icon={ShieldCheck}
      description="ניהול גלובלי של הרשאות ותפקידים על פני כל הסניפים."
    />
  ),
});
