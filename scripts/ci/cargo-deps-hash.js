#!/usr/bin/env node
/**
 * Hashes the Rust dependency set — `Cargo.lock`'s registry/git packages plus `Cargo.toml` with the
 * app's own version removed — for the rust-cache `key`. Being part of the key, it is part of the
 * restore prefix, so a dependency change starts cold instead of saving new artifacts beside the old
 * ones. See docs/development/ci-caching.md.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

function externalPackages(lockText) {
  return lockText
    .split(/^(?=\[\[package\]\]$)/m)
    .filter((block) => block.startsWith('[[package]]') && /^source = /m.test(block))
    .join('')
}

function manifestWithoutVersion(manifestText) {
  let section = ''
  return manifestText
    .split('\n')
    .filter((line) => {
      const header = /^\[([^\]]+)\]\s*$/.exec(line)
      if (header) section = header[1].trim()
      return !(section === 'package' && /^version\s*=/.test(line))
    })
    .join('\n')
}

export function cargoDepsHash(lockText, manifestText) {
  const lf = (text) => text.replaceAll('\r\n', '\n')
  return createHash('sha256')
    .update(externalPackages(lf(lockText)))
    .update('\0')
    .update(manifestWithoutVersion(lf(manifestText)))
    .digest('hex')
    .slice(0, 16)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(
    cargoDepsHash(
      readFileSync('src-tauri/Cargo.lock', 'utf8'),
      readFileSync('src-tauri/Cargo.toml', 'utf8'),
    ),
  )
}
