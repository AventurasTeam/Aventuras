import { contextBridge, ipcRenderer } from 'electron'

import type { DbBridge } from './db/types'
import type { EmbedderBridge, EmbedderDownloadProgress } from './embedder/types'

const api = {
  platform: process.platform,
  revealDbFile: (): Promise<void> => ipcRenderer.invoke('native:reveal-db-file'),
} as const

contextBridge.exposeInMainWorld('native', api)

const dbBridge: DbBridge = {
  query: (sql, params, method) => ipcRenderer.invoke('db:query', sql, params, method),
  exec: (sql) => ipcRenderer.invoke('db:exec', sql),
  transaction: (ops) => ipcRenderer.invoke('db:transaction', ops),
}

contextBridge.exposeInMainWorld('aventurasDb', dbBridge)

const embedderBridge: EmbedderBridge & {
  onDownloadProgress(cb: (progress: EmbedderDownloadProgress) => void): () => void
} = {
  embed: (args) => ipcRenderer.invoke('embedder:embed', args),
  smokeTest: (args) => ipcRenderer.invoke('embedder:smoke-test', args),
  listInstalled: () => ipcRenderer.invoke('embedder:list-installed'),
  downloadFile: (args) => ipcRenderer.invoke('embedder:download-file', args),
  persistInstall: (args) => ipcRenderer.invoke('embedder:persist-install', args),
  deletePartial: (args) => ipcRenderer.invoke('embedder:delete-partial', args),
  embeddersRoot: () => ipcRenderer.invoke('embedder:root'),
  onDownloadProgress: (cb) => {
    const listener = (_e: unknown, progress: EmbedderDownloadProgress): void => cb(progress)
    ipcRenderer.on('embedder:download-progress', listener)
    return () => ipcRenderer.removeListener('embedder:download-progress', listener)
  },
}

contextBridge.exposeInMainWorld('aventurasEmbedder', embedderBridge)

export type NativeApi = typeof api
