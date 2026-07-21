// Canonical model-id → folder-name rule shared by the desktop bridge path
// resolution (lib side) and the native embedders-root scan. Must stay in lock-step
// with electron/embedder/paths.ts's own copy (electron/ and lib/ don't share
// imports in this repo) — the on-disk folder name is the contract between them.
export function sanitizeModelDirName(id: string): string {
  return id.toLowerCase().replaceAll('/', '--')
}
