import { describe, expect, it } from 'vitest'

import { sanitizeModelDirName } from './sanitize'

// Lock-step with electron/embedder/paths.ts's own copy (the on-disk folder name is
// the contract between the two trees, which don't share imports). These cases mirror
// electron/embedder/paths.test.ts's sanitization block.
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
