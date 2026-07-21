import { existsSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

import { app } from 'electron'

// Canon roots the embedders dir at Electron's per-app userData on every desktop
// platform (docs/memory/model-management.md → Storage layout), so models sit next
// to the SQLite DB. userData already carries dev/prod separation (dev sets
// app.setName('aventuras-dev') in main.ts), so this root inherits it for free.
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

// Leading char excludes '.', so '.' / '..' / dotfiles can't be written, and the
// class excludes both separators — join() can then never escape the model dir.
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function assertSafeFileName(fileName: string): string {
  if (!SAFE_FILE_NAME.test(fileName)) {
    throw new Error(`Invalid file name: ${fileName}`)
  }
  return fileName
}

// The renderer is not a trusted principal: it renders remote model-card HTML, so
// a sanitizer bypass must not become "main fetches any origin on demand".
const ALLOWED_DOWNLOAD_ORIGIN = 'https://huggingface.co'

export function assertAllowedDownloadUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid download URL: ${url}`)
  }
  if (parsed.origin !== ALLOWED_DOWNLOAD_ORIGIN) {
    throw new Error(`Download URL origin not allowed: ${parsed.origin}`)
  }
  return url
}

const SHA256_HEX = /^[0-9a-f]{64}$/i

export function assertSha256(value: unknown, fileName: string): string {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) {
    throw new Error(`Missing or malformed expected SHA-256 for ${fileName}`)
  }
  return value
}
