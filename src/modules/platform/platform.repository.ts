import { BaseRepository, type IDatabaseClient, type IRepository } from "@/core";
import type { Platform } from "./platform.model";

export type IPlatformRepository = IRepository<Platform>;

export class PlatformRepository extends BaseRepository<Platform> implements IPlatformRepository {
  constructor(db: IDatabaseClient) {
    super(db, "platforms");
  }
}
