import { describe, expect, it } from 'vitest'

import {
  EMBEDDER_CATALOG,
  embedderCatalogSchema,
  getCatalogEntry,
  getDefaultCatalogEntry,
  localModelDim,
  localModelMaxInputTokens,
} from './catalog'
import { EMBEDDER_INTEGRATIONS } from './integrations'

const REVISION_RE = /^[0-9a-f]{40}$/
const SHA256_RE = /^[0-9a-f]{64}$/

describe('EMBEDDER_CATALOG', () => {
  it('parses with at least one model', () => {
    expect(EMBEDDER_CATALOG.models.length).toBeGreaterThan(0)
  })

  it('default entry is the MiniLM id', () => {
    const defaultEntry = getDefaultCatalogEntry()
    expect(defaultEntry.id).toBe('Xenova/all-MiniLM-L6-v2')
    expect(defaultEntry.tags).toContain('default')
  })

  it('every catalog entry has an EMBEDDER_INTEGRATIONS record', () => {
    for (const model of EMBEDDER_CATALOG.models) {
      expect(EMBEDDER_INTEGRATIONS[model.id]).toBeDefined()
    }
  })

  it('every huggingfaceRevision is a full commit hash', () => {
    for (const model of EMBEDDER_CATALOG.models) {
      expect(model.huggingfaceRevision).toMatch(REVISION_RE)
    }
  })

  it('every file carries a sha256 hex digest', () => {
    for (const model of EMBEDDER_CATALOG.models) {
      for (const file of Object.values(model.files)) {
        expect(file.sha256).toMatch(SHA256_RE)
      }
    }
  })

  it('localModelDim returns the known dim for MiniLM', () => {
    expect(localModelDim('Xenova/all-MiniLM-L6-v2')).toBe(384)
  })

  it('localModelDim returns the known dim for EmbeddingGemma', () => {
    expect(localModelDim('onnx-community/embeddinggemma-300m-ONNX')).toBe(768)
  })

  it('localModelDim returns undefined for an unknown id', () => {
    expect(localModelDim('nonexistent/model')).toBeUndefined()
  })

  it('EmbeddingGemma entry carries a weights-sidecar files entry', () => {
    const gemma = getCatalogEntry('onnx-community/embeddinggemma-300m-ONNX')
    expect(gemma?.files['model_quantized.onnx_data']?.repoPath).toBe(
      'onnx/model_quantized.onnx_data',
    )
  })

  it('every catalog entry includes config.json in its files map', () => {
    for (const model of EMBEDDER_CATALOG.models) {
      expect(model.files['config.json'].repoPath).toBe('config.json')
    }
  })

  it('getCatalogEntry returns undefined for an unknown id', () => {
    expect(getCatalogEntry('nonexistent/model')).toBeUndefined()
  })
})

describe('embedderCatalogSchema', () => {
  function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const file = (repoPath: string) => ({ repoPath, sha256: 'a'.repeat(64) })
    return {
      id: 'acme/model',
      displayName: 'Model',
      shortDescription: 'desc',
      size_bytes: 1,
      dim: 384,
      maxInputTokens: 512,
      huggingfaceRevision: 'b'.repeat(40),
      files: {
        'model.onnx': file('onnx/model.onnx'),
        'config.json': file('config.json'),
        'tokenizer.json': file('tokenizer.json'),
        'tokenizer_config.json': file('tokenizer_config.json'),
      },
      default_ep: { android: 'cpu', ios: 'cpu', linux: 'cpu', macos: 'cpu', windows: 'cpu' },
      tags: ['default'],
      ...overrides,
    }
  }

  function parse(
    models: Record<string, unknown>[],
  ): ReturnType<typeof embedderCatalogSchema.parse> {
    return embedderCatalogSchema.parse({ version: '1', models })
  }

  it('accepts a well-formed catalog', () => {
    expect(() => parse([entry()])).not.toThrow()
  })

  it('rejects a file whose sha256 is not a 64-char hex digest', () => {
    const files = entry().files as Record<string, unknown>
    expect(() =>
      parse([entry({ files: { ...files, 'model.onnx': { repoPath: 'x', sha256: 'nope' } } })]),
    ).toThrow()
  })

  it('rejects a file entry with no sha256 at all — verification must not be skippable', () => {
    const files = entry().files as Record<string, unknown>
    expect(() =>
      parse([entry({ files: { ...files, 'extra.bin': { repoPath: 'extra.bin' } } })]),
    ).toThrow()
  })

  it('rejects an entry missing config.json', () => {
    const files = { ...(entry().files as Record<string, unknown>) }
    delete files['config.json']
    expect(() => parse([entry({ files })])).toThrow()
  })

  it('rejects a catalog with two default-tagged models', () => {
    expect(() => parse([entry(), entry({ id: 'acme/other' })])).toThrow(/exactly one/)
  })

  it('rejects a catalog with no default-tagged model', () => {
    expect(() => parse([entry({ tags: ['mobile'] })])).toThrow(/exactly one/)
  })
})

// The window decides what gets silently dropped, so an entry omitting it must not parse.
describe('maxInputTokens', () => {
  it('is declared by every catalog entry', () => {
    for (const model of EMBEDDER_CATALOG.models) {
      expect(model.maxInputTokens).toBeGreaterThan(0)
    }
  })

  // Known answers, read from each model's own installed tokenizer_config.json.
  it('matches the tokenizer each model actually ships', () => {
    expect(localModelMaxInputTokens('Xenova/all-MiniLM-L6-v2')).toBe(512)
    expect(localModelMaxInputTokens('onnx-community/embeddinggemma-300m-ONNX')).toBe(2048)
  })

  it('is undefined for a model the catalog does not carry', () => {
    expect(localModelMaxInputTokens('acme/not-in-catalog')).toBeUndefined()
  })

  it('rejects a catalog entry that omits it', () => {
    const { maxInputTokens: _omitted, ...withoutWindow } = {
      id: 'acme/model',
      displayName: 'Model',
      shortDescription: 'desc',
      size_bytes: 1,
      dim: 384,
      maxInputTokens: 512,
      huggingfaceRevision: 'b'.repeat(40),
      files: {
        'model.onnx': { repoPath: 'onnx/model.onnx', sha256: 'a'.repeat(64) },
        'config.json': { repoPath: 'config.json', sha256: 'a'.repeat(64) },
        'tokenizer.json': { repoPath: 'tokenizer.json', sha256: 'a'.repeat(64) },
        'tokenizer_config.json': { repoPath: 'tokenizer_config.json', sha256: 'a'.repeat(64) },
      },
      default_ep: { android: 'cpu', ios: 'cpu', linux: 'cpu', macos: 'cpu', windows: 'cpu' },
      tags: ['default'],
    }
    expect(() => embedderCatalogSchema.parse({ version: '1', models: [withoutWindow] })).toThrow()
  })
})
