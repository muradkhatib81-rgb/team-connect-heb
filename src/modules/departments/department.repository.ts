import { BaseRepository, type IDatabaseClient, type IRepository } from "@/core";
import type { Department } from "./department.model";

export type IDepartmentRepository = IRepository<Department>;

export class DepartmentRepository extends BaseRepository<Department> implements IDepartmentRepository {
  constructor(db: IDatabaseClient) {
    super(db, "departments");
  }
}
