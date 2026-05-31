import { contextBridge, ipcRenderer } from 'electron'

import type { DbBridge } from './db/types'

const api = {
  platform: process.platform,
  ping: (): Promise<string> => ipcRenderer.invoke('native:ping'),
  revealDbFile: (): Promise<void> => ipcRenderer.invoke('native:reveal-db-file'),
} as const

contextBridge.exposeInMainWorld('native', api)

const dbBridge: DbBridge = {
  query: (sql, params, method) => ipcRenderer.invoke('db:query', sql, params, method),
  exec: (sql) => ipcRenderer.invoke('db:exec', sql),
  transaction: (ops) => ipcRenderer.invoke('db:transaction', ops),
}

contextBridge.exposeInMainWorld('aventurasDb', dbBridge)

export type NativeApi = typeof api
