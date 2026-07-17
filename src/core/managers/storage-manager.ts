/** Storage Manager — file storage abstraction, mirrors the Database Layer pattern. Not connected. */

import { BaseManager } from "./manager.interface";

export interface IFileStorageClient {
  upload(path: string, data: Blob | ArrayBuffer): Promise<string>;
  getUrl(path: string): Promise<string>;
  remove(path: string): Promise<void>;
}

export class NotConnectedFileStorageClient implements IFileStorageClient {
  async upload(): Promise<string> {
    return this.notConnected();
  }
  async getUrl(): Promise<string> {
    return this.notConnected();
  }
  async remove(): Promise<void> {
    return this.notConnected();
  }
  private notConnected(): never {
    throw new Error(
      "Storage Layer is prepared but not connected. Supabase Storage integration is deferred.",
    );
  }
}

export class StorageManager extends BaseManager {
  constructor(private readonly client: IFileStorageClient = new NotConnectedFileStorageClient()) {
    super("storage-manager");
  }

  upload(path: string, data: Blob | ArrayBuffer): Promise<string> {
    return this.client.upload(path, data);
  }

  getUrl(path: string): Promise<string> {
    return this.client.getUrl(path);
  }

  remove(path: string): Promise<void> {
    return this.client.remove(path);
  }
}
