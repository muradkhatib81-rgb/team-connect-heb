import { createFileRoute } from "@tanstack/react-router";
import { UserCog } from "lucide-react";
import { SystemAdminPlaceholder } from "@/components/system-admin-placeholder";

export const Route = createFileRoute("/_authenticated/system/branch-managers")({
  component: () => (
    <SystemAdminPlaceholder
      title="מנהלי סניפים"
      icon={UserCog}
      description="הקצאה והעברה של מנהלי סניפים בין הסניפים השונים."
    />
  ),
});
