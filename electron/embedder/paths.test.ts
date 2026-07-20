import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { embeddersRoot, resolveModelDir, sanitizeModelDirName } from './paths'

vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'aventuras-embedder-test-userdata') },
}))

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), 'embedders-root-'))
}

describe('sanitizeModelDirName', () => {
  it('lowercases and maps / to --', () => {
    expect(sanitizeModelDirName('Xenova/all-MiniLM-L6-v2')).toBe('xenova--all-minilm-l6-v2')
  })

  it('maps every / in a nested id', () => {
    expect(sanitizeModelDirName('onnx-community/embeddinggemma-300m-ONNX')).toBe(
      'onnx-community--embeddinggemma-300m-onnx',
    )
  })
})

describe('resolveModelDir — traversal guard', () => {
  it('resolves a clean id to a direct child of root', () => {
    const root = freshRoot()
    expect(resolveModelDir(root, 'Xenova/all-MiniLM-L6-v2')).toBe(
      join(root, 'xenova--all-minilm-l6-v2'),
    )
  })

  it('rejects ../../x', () => {
    const root = freshRoot()
    expect(() => resolveModelDir(root, '../../x')).toThrow()
  })

  it('rejects a/../../b', () => {
    const root = freshRoot()
    expect(() => resolveModelDir(root, 'a/../../b')).toThrow()
  })

  it('rejects a bare .. segment', () => {
    const root = freshRoot()
    expect(() => resolveModelDir(root, '..')).toThrow()
  })
})

describe('resolveModelDir — collision guard', () => {
  it('rejects an id colliding with an existing different-cased folder', () => {
    const root = freshRoot()
    mkdirSync(join(root, 'Foo--Bar'))
    expect(() => resolveModelDir(root, 'foo/bar')).toThrow()
  })

  it('allows re-resolving the same lowercased folder (re-download)', () => {
    const root = freshRoot()
    mkdirSync(join(root, 'foo--bar'))
    expect(resolveModelDir(root, 'foo/bar')).toBe(join(root, 'foo--bar'))
  })
})

describe('embeddersRoot', () => {
  it('is an embedders folder under userData', () => {
    expect(embeddersRoot().endsWith(join('aventuras-embedder-test-userdata', 'embedders'))).toBe(
      true,
    )
  })
})
