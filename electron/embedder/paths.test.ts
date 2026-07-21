import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  assertAllowedDownloadUrl,
  assertSafeFileName,
  assertSha256,
  embeddersRoot,
  resolveModelDir,
  sanitizeModelDirName,
} from './paths'

// Keyed on the requested path name so the root can't silently come from 'temp'.
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) =>
      name === 'userData'
        ? join(tmpdir(), 'aventuras-embedder-test-userdata')
        : join(tmpdir(), `aventuras-embedder-test-${name}`),
  },
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

describe('assertSafeFileName', () => {
  it.each(['model.onnx', 'config.json', 'model_quantized.onnx_data', 'tokenizer_config.json'])(
    'accepts the catalog file name %s',
    (name) => {
      expect(assertSafeFileName(name)).toBe(name)
    },
  )

  it.each([
    '../../../../../.bashrc',
    'sub/../../evil',
    'a/b',
    'a\\b',
    '..',
    '.',
    '.hidden',
    '',
    '/etc/passwd',
  ])('rejects %s', (name) => {
    expect(() => assertSafeFileName(name)).toThrow(/Invalid file name/)
  })

  it('would escape the model dir if unguarded', () => {
    // Pins the reason the guard exists rather than just its regex.
    expect(join('/home/u/embedders/m', '../../../../.bashrc')).toBe('/.bashrc')
  })
})

describe('assertAllowedDownloadUrl', () => {
  it('accepts a huggingface.co resolve URL', () => {
    const url = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/abc/onnx/model.onnx'
    expect(assertAllowedDownloadUrl(url)).toBe(url)
  })

  it.each([
    'https://evil.example/model.onnx',
    'http://huggingface.co/x',
    'https://huggingface.co.evil.example/x',
    'file:///etc/passwd',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => assertAllowedDownloadUrl(url)).toThrow()
  })
})

describe('assertSha256', () => {
  it('accepts a 64-char hex digest', () => {
    const hex = 'a'.repeat(64)
    expect(assertSha256(hex, 'model.onnx')).toBe(hex)
  })

  it.each([[undefined], [null], [''], ['abc'], ['g'.repeat(64)], ['a'.repeat(63)], [42]])(
    'rejects %s so a missing catalog hash cannot skip verification',
    (value) => {
      expect(() => assertSha256(value, 'model.onnx')).toThrow(/SHA-256/)
    },
  )
})
