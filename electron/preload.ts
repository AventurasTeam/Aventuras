import { contextBridge, ipcRenderer } from 'electron';

const api = {
  platform: process.platform,
  ping: (): Promise<string> => ipcRenderer.invoke('native:ping'),
} as const;

contextBridge.exposeInMainWorld('native', api);

export type NativeApi = typeof api;
