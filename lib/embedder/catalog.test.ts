import { describe, expect, it } from 'vitest'

import { EMBEDDER_CATALOG, getCatalogEntry, getDefaultCatalogEntry, localModelDim } from './catalog'
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

  it('every expectedSha256 value is a sha256 hex digest', () => {
    for (const model of EMBEDDER_CATALOG.models) {
      for (const hash of Object.values(model.expectedSha256)) {
        expect(hash).toMatch(SHA256_RE)
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
    expect(gemma).toBeDefined()
    expect(gemma?.files['model_quantized.onnx_data']).toBe('onnx/model_quantized.onnx_data')
    expect(Object.keys(gemma?.expectedSha256 ?? {})).toHaveLength(4)
    for (const hash of Object.values(gemma?.expectedSha256 ?? {})) {
      expect(hash).toMatch(SHA256_RE)
    }
  })

  it('getCatalogEntry returns undefined for an unknown id', () => {
    expect(getCatalogEntry('nonexistent/model')).toBeUndefined()
  })
})
