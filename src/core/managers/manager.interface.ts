/** Common lifecycle contract shared by all Core Managers. Managers stay independent. */

export interface IManager {
  readonly name: string;
  init(): Promise<void>;
  dispose(): Promise<void>;
}

export abstract class BaseManager implements IManager {
  constructor(public readonly name: string) {}
  async init(): Promise<void> {}
  async dispose(): Promise<void> {}
}
