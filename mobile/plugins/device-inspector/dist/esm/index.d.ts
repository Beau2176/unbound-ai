export interface DeviceInspectorSnapshot {
  platform: string;
  system: {
    osVersion?: string;
    cpuCores?: number;
    memoryTotalMb?: number;
    memoryAvailableMb?: number;
    storageTotalMb?: number;
    storageAvailableMb?: number;
    batteryPercent?: number;
    charging?: boolean;
  };
  apps: Array<{ name: string; packageName: string }>;
  processes: Array<{ name: string; processName: string }>;
}
export interface UnboundDeviceInspectorPlugin {
  requestAccess(options?: { scopes?: string[] }): Promise<{ granted: boolean; scopes: string[] }>;
  getSnapshot(options?: { scopes?: string[] }): Promise<DeviceInspectorSnapshot>;
}
export declare const UnboundDeviceInspector: UnboundDeviceInspectorPlugin;
