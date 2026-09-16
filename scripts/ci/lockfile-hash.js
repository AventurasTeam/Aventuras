#!/usr/bin/env node
/**
 * Hashes `package-lock.json` with the app's own version stripped out, so a release's
 * version-bump commit does not change the hash. Used as the npm cache key in CI: without
 * this, `scripts/release.js` bumping `package.json`/`package-lock.json` would miss the
 * cache on every single release, and every release run would save a cache entry nobody
 * else can use.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function lockfileHash(lock) {
  const stripped = structuredClone(lock)
  delete stripped.version
  if (stripped.packages?.['']) {
    delete stripped.packages[''].version
  }
  return createHash('sha256').update(JSON.stringify(stripped)).digest('hex')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2] ?? 'package-lock.json'
  const lock = JSON.parse(readFileSync(path, 'utf8'))
  console.log(lockfileHash(lock))
}
