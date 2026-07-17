/** Device Manager — tracks known devices independently from Session Manager. */

import type { UUID } from "../types";
import { generateUUID } from "../types";
import { BaseManager } from "./manager.interface";
import type { DeviceInfo } from "../auth/types";

export class DeviceManager extends BaseManager {
  private readonly devices = new Map<UUID, DeviceInfo>();

  constructor() {
    super("device-manager");
  }

  register(info: Omit<DeviceInfo, "deviceId">): DeviceInfo {
    const device: DeviceInfo = { ...info, deviceId: generateUUID() };
    this.devices.set(device.deviceId, device);
    return device;
  }

  get(deviceId: UUID): DeviceInfo | undefined {
    return this.devices.get(deviceId);
  }

  list(): DeviceInfo[] {
    return [...this.devices.values()];
  }
}
