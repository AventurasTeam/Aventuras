import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, beforeAll } from 'vitest'

import { resolveBundlePath } from './bundle-path'

let distRoot: string
let indexHtml: string

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'aventuras-bundle-path-'))
  distRoot = join(root, 'dist')
  mkdirSync(join(distRoot, '_expo', 'static'), { recursive: true })
  indexHtml = join(distRoot, 'index.html')
  writeFileSync(indexHtml, '<!doctype html>')
  writeFileSync(join(distRoot, 'favicon.ico'), 'x')
  writeFileSync(join(distRoot, '_expo', 'static', 'app.v1.2.js'), 'x')

  // The sibling the traversal guard's prefix compare must not admit.
  mkdirSync(join(root, 'dist-evil'), { recursive: true })
  writeFileSync(join(root, 'dist-evil', 'secret.txt'), 'x')
})

describe('resolveBundlePath', () => {
  it('serves a real asset from its own path', () => {
    expect(resolveBundlePath('/favicon.ico', distRoot)).toBe(join(distRoot, 'favicon.ico'))
  })

  it('serves the shell at the root', () => {
    expect(resolveBundlePath('/', distRoot)).toBe(indexHtml)
  })

  it('serves a dotted asset path that exists', () => {
    expect(resolveBundlePath('/_expo/static/app.v1.2.js', distRoot)).toBe(
      join(distRoot, '_expo', 'static', 'app.v1.2.js'),
    )
  })

  // app.json sets web output to `single`, so no deep route exists on disk.
  it.each([
    '/settings',
    '/diagnostics',
    '/story-settings/story_abc',
    '/reader-composer/story_abc',
    '/dev/probe-captures',
  ])('falls back to the shell for deep route %s', (route) => {
    expect(resolveBundlePath(route, distRoot)).toBe(indexHtml)
  })

  // A route param carrying a dot is why extension sniffing can't be the test.
  it('falls back to the shell for a deep route whose param contains a dot', () => {
    expect(resolveBundlePath('/story-settings/story_a.b', distRoot)).toBe(indexHtml)
  })

  it('falls back to the shell for a percent-encoded traversal', () => {
    expect(resolveBundlePath('/%2e%2e%2f%2e%2e%2fetc%2fpasswd', distRoot)).toBe(indexHtml)
  })

  it('falls back to the shell for a sibling dir sharing the dist prefix', () => {
    expect(resolveBundlePath('/../dist-evil/secret.txt', distRoot)).toBe(indexHtml)
  })

  it('falls back to the shell for malformed percent-encoding', () => {
    expect(resolveBundlePath('/%E0%A4%A', distRoot)).toBe(indexHtml)
  })
})
