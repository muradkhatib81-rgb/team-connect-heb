import { BaseRepository, type IDatabaseClient, type IRepository } from "@/core";
import type { Employee } from "./employee.model";

export type IEmployeeRepository = IRepository<Employee>;

export class EmployeeRepository extends BaseRepository<Employee> implements IEmployeeRepository {
  constructor(db: IDatabaseClient) {
    super(db, "employees");
  }
}
