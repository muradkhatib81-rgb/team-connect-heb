import { createFileRoute, Outlet } from "@tanstack/react-router";

/** Layout route so `/platform/companies/$companyId` can render via `<Outlet />`. */
export const Route = createFileRoute("/_authenticated/platform/companies")({
  component: () => <Outlet />,
});
