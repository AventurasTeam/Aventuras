import { existsSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

import { app } from 'electron'

// userData already carries dev/prod separation (dev sets app.setName('aventuras-dev')
// in main.ts), so a userData-relative embedders root inherits it for free — matching
// the per-platform table in docs/memory/model-management.md → Storage layout.
export function embeddersRoot(): string {
  return join(app.getPath('userData'), 'embedders')
}

export function sanitizeModelDirName(id: string): string {
  return id.toLowerCase().replaceAll('/', '--')
}

export function resolveModelDir(root: string, id: string): string {
  const segments = id.split(/[/\\]/)
  if (segments.some((s) => s === '.' || s === '..' || s.length === 0)) {
    throw new Error(`Invalid model id (path traversal): ${id}`)
  }

  const name = sanitizeModelDirName(id)
  if (name.includes(sep) || name.includes('/')) {
    throw new Error(`Invalid model id: ${id}`)
  }

  const rootResolved = resolve(root)
  const dir = resolve(rootResolved, name)
  if (dir !== join(rootResolved, name) || !dir.startsWith(rootResolved + sep)) {
    throw new Error(`Invalid model id (escapes root): ${id}`)
  }

  if (existsSync(rootResolved)) {
    const clash = readdirSync(rootResolved).find(
      (folder) => folder.toLowerCase() === name && folder !== name,
    )
    if (clash) throw new Error(`Model id collides with existing folder: ${clash}`)
  }

  return dir
}

export function modelDir(id: string): string {
  return resolveModelDir(embeddersRoot(), id)
}
