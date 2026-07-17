import { BaseRepository, type IDatabaseClient, type IRepository } from "@/core";
import type { Dashboard } from "./dashboard.model";

export type IDashboardRepository = IRepository<Dashboard>;

export class DashboardRepository extends BaseRepository<Dashboard> implements IDashboardRepository {
  constructor(db: IDatabaseClient) {
    super(db, "dashboards");
  }
}
