import { contextBridge, ipcRenderer } from 'electron'

import type { DbBridge } from './db/types'
import type { EmbedderBridge, EmbedderDownloadProgress } from './embedder/types'
import type { NativeApi } from './native/types'

const api: NativeApi = {
  platform: process.platform,
  revealDbFile: (): Promise<void> => ipcRenderer.invoke('native:reveal-db-file'),
  setCloseGuard: (active: boolean): void => {
    ipcRenderer.send('native:set-close-guard', active)
  },
  confirmClose: (): void => {
    ipcRenderer.send('native:confirm-close')
  },
  onCloseRequested: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('native:close-requested', listener)
    return () => ipcRenderer.removeListener('native:close-requested', listener)
  },
  confirmReload: (): void => {
    ipcRenderer.send('native:confirm-reload')
  },
  onReloadRequested: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('native:reload-requested', listener)
    return () => ipcRenderer.removeListener('native:reload-requested', listener)
  },
}

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
  cancelDownload: (args) => ipcRenderer.invoke('embedder:cancel-download', args),
  cancelEmbed: (args) => ipcRenderer.invoke('embedder:cancel-embed', args),
  deletePartial: (args) => ipcRenderer.invoke('embedder:delete-partial', args),
  onDownloadProgress: (cb) => {
    const listener = (_e: unknown, progress: EmbedderDownloadProgress): void => cb(progress)
    ipcRenderer.on('embedder:download-progress', listener)
    return () => ipcRenderer.removeListener('embedder:download-progress', listener)
  },
}

contextBridge.exposeInMainWorld('aventurasEmbedder', embedderBridge)
