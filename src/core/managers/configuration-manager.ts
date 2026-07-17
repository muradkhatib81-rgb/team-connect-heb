/** Configuration Manager — facade over the ConfigurationStore (see ../config). */

import { BaseManager } from "./manager.interface";
import { ConfigurationStore } from "../config/configuration-store";

export class ConfigurationManager extends BaseManager {
  constructor(private readonly store: ConfigurationStore = new ConfigurationStore()) {
    super("configuration-manager");
  }

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, value);
  }
}
