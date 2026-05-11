import { describe, expect, it } from 'vitest'

import {
  type CatalogEntry,
  type DialogState,
  type ImportBundle,
  type ModelMeta,
  initialState,
  reducer,
} from './embedder-download-dialog-machine'

const sampleEntry: CatalogEntry = {
  id: 'minilm-l6',
  displayName: 'MiniLM-L6 (lightweight)',
  source: 'huggingface.co/Xenova/all-MiniLM-L6-v2-q8',
  revision: 'abc123def456',
  sizeBytes: 25_000_000,
  files: ['model.onnx', 'tokenizer.json', 'tokenizer_config.json'],
  expectedSha256: {
    'model.onnx': 'aaa',
    'tokenizer.json': 'bbb',
    'tokenizer_config.json': 'ccc',
  },
}

const sampleMeta: ModelMeta = {
  displayName: sampleEntry.displayName,
  source: sampleEntry.source,
  revision: sampleEntry.revision,
  sizeBytes: sampleEntry.sizeBytes,
  fileCount: sampleEntry.files.length,
}

const sampleBundle: ImportBundle = {
  modelId: 'my-org/my-finetune',
  files: [
    { name: 'model.onnx', path: '/tmp/model.onnx', sizeBytes: 42_000_000 },
    { name: 'tokenizer.json', path: '/tmp/tokenizer.json', sizeBytes: 1_200_000 },
    { name: 'tokenizer_config.json', path: '/tmp/tokenizer_config.json', sizeBytes: 3_000 },
  ],
}

describe('initialState', () => {
  it('catalog init jumps to card-fetch with derived meta', () => {
    const state = initialState({ kind: 'catalog', entry: sampleEntry })
    expect(state.kind).toBe('card-fetch')
    if (state.kind === 'card-fetch') {
      expect(state.meta.displayName).toBe(sampleEntry.displayName)
      expect(state.meta.fileCount).toBe(3)
    }
  })

  it('hf-id init with non-empty input goes to resolving', () => {
    const state = initialState({ kind: 'hf-id', input: 'Xenova/all-MiniLM-L6-v2-q8' })
    expect(state.kind).toBe('resolving')
  })

  it('hf-id init with empty input goes to hf-input', () => {
    const state = initialState({ kind: 'hf-id', input: '' })
    expect(state.kind).toBe('hf-input')
  })

  it('import init jumps to import-confirm with pickedEp from init', () => {
    const state = initialState({ kind: 'import', files: sampleBundle, ep: 'cpu' })
    expect(state.kind).toBe('import-confirm')
    if (state.kind === 'import-confirm') {
      expect(state.pickedEp).toBe('cpu')
      expect(state.bundle).toBe(sampleBundle)
    }
  })
})

describe('reducer — card-fetch state', () => {
  it('card-fetched transitions to license', () => {
    const before: DialogState = { kind: 'card-fetch', meta: sampleMeta }
    const after = reducer(before, {
      type: 'card-fetched',
      meta: sampleMeta,
      licenseText: 'Apache 2.0 …',
      licenseName: 'Apache 2.0',
    })
    expect(after.kind).toBe('license')
    if (after.kind === 'license') {
      expect(after.licenseName).toBe('Apache 2.0')
    }
  })

  it('card-fetch-failed transitions to failed with card-fetch-failed reason', () => {
    const before: DialogState = { kind: 'card-fetch', meta: sampleMeta }
    const after = reducer(before, {
      type: 'card-fetch-failed',
      message: 'Network unreachable',
    })
    expect(after.kind).toBe('failed')
    if (after.kind === 'failed') {
      expect(after.reason.kind).toBe('card-fetch-failed')
    }
  })

  it('cancel from card-fetch transitions to failed with cancelled reason', () => {
    const before: DialogState = { kind: 'card-fetch', meta: sampleMeta }
    const after = reducer(before, { type: 'cancel' })
    expect(after.kind).toBe('failed')
  })

  it('cancel from card-fetch sets reason.kind to cancelled', () => {
    const before: DialogState = { kind: 'card-fetch', meta: sampleMeta }
    const after = reducer(before, { type: 'cancel' })
    expect(after.kind).toBe('failed')
    if (after.kind === 'failed') {
      expect(after.reason.kind).toBe('cancelled')
    }
  })
})

describe('reducer — license state', () => {
  it('license-accepted transitions to downloading with empty progressByFile', () => {
    const before: DialogState = {
      kind: 'license',
      meta: sampleMeta,
      licenseText: '…',
      licenseName: 'Apache 2.0',
    }
    const after = reducer(before, { type: 'license-accepted' })
    expect(after.kind).toBe('downloading')
    if (after.kind === 'downloading') {
      expect(Object.keys(after.progressByFile)).toHaveLength(0)
    }
  })

  it('license-declined transitions to done (container maps to declined resolution)', () => {
    const before: DialogState = {
      kind: 'license',
      meta: sampleMeta,
      licenseText: '…',
      licenseName: 'Apache 2.0',
    }
    const after = reducer(before, { type: 'license-declined' })
    expect(after.kind).toBe('done')
  })
})

describe('reducer — downloading state', () => {
  it('download-progress updates per-file progress', () => {
    const before: DialogState = {
      kind: 'downloading',
      meta: sampleMeta,
      progressByFile: {},
    }
    const after = reducer(before, {
      type: 'download-progress',
      file: 'model.onnx',
      bytesReceived: 5_000_000,
      bytesTotal: 25_000_000,
    })
    expect(after.kind).toBe('downloading')
    if (after.kind === 'downloading') {
      expect(after.progressByFile['model.onnx']).toEqual({
        kind: 'downloading',
        bytesReceived: 5_000_000,
        bytesTotal: 25_000_000,
      })
    }
  })

  it('download-complete marks file done', () => {
    const before: DialogState = {
      kind: 'downloading',
      meta: sampleMeta,
      progressByFile: {
        'model.onnx': { kind: 'downloading', bytesReceived: 25_000_000, bytesTotal: 25_000_000 },
      },
    }
    const after = reducer(before, { type: 'download-complete', file: 'model.onnx' })
    if (after.kind === 'downloading') {
      expect(after.progressByFile['model.onnx']).toEqual({ kind: 'done' })
    }
  })

  it('all-downloaded transitions downloading to verifying with all files pending', () => {
    const before: DialogState = {
      kind: 'downloading',
      meta: sampleMeta,
      progressByFile: { 'model.onnx': { kind: 'done' }, 'tokenizer.json': { kind: 'done' } },
    }
    const after = reducer(before, { type: 'all-downloaded' })
    expect(after.kind).toBe('verifying')
    if (after.kind === 'verifying') {
      expect(after.verifyByFile['model.onnx']).toBe('pending')
      expect(after.verifyByFile['tokenizer.json']).toBe('pending')
    }
  })

  it('download-failed transitions downloading to failed with card-fetch-failed reason', () => {
    const before: DialogState = {
      kind: 'downloading',
      meta: sampleMeta,
      progressByFile: {
        'model.onnx': { kind: 'downloading', bytesReceived: 5_000_000, bytesTotal: 25_000_000 },
      },
    }
    const after = reducer(before, {
      type: 'download-failed',
      file: 'model.onnx',
      message: 'connection reset',
    })
    expect(after.kind).toBe('failed')
    if (after.kind === 'failed') {
      expect(after.reason.kind).toBe('card-fetch-failed')
      if (after.reason.kind === 'card-fetch-failed') {
        expect(after.reason.message).toContain('model.onnx')
        expect(after.reason.message).toContain('connection reset')
      }
    }
  })

  it('cancel from downloading transitions to failed with cancelled reason', () => {
    const before: DialogState = {
      kind: 'downloading',
      meta: sampleMeta,
      progressByFile: {},
    }
    const after = reducer(before, { type: 'cancel' })
    expect(after.kind).toBe('failed')
  })
})

describe('reducer — verifying state', () => {
  it('verify-progress updates per-file verify state', () => {
    const before: DialogState = {
      kind: 'verifying',
      meta: sampleMeta,
      verifyByFile: { 'model.onnx': 'pending' },
    }
    const after = reducer(before, {
      type: 'verify-progress',
      file: 'model.onnx',
      result: 'ok',
    })
    if (after.kind === 'verifying') {
      expect(after.verifyByFile['model.onnx']).toBe('ok')
    }
  })

  it('all-verified transitions verifying to done', () => {
    const before: DialogState = {
      kind: 'verifying',
      meta: sampleMeta,
      verifyByFile: { 'model.onnx': 'ok', 'tokenizer.json': 'ok' },
    }
    const after = reducer(before, { type: 'all-verified' })
    expect(after.kind).toBe('done')
  })

  it('verify-failed transitions to failed with hash-mismatch', () => {
    const before: DialogState = {
      kind: 'verifying',
      meta: sampleMeta,
      verifyByFile: { 'model.onnx': 'ok', 'tokenizer.json': 'pending' },
    }
    const after = reducer(before, { type: 'verify-failed', file: 'tokenizer.json' })
    expect(after.kind).toBe('failed')
    if (after.kind === 'failed') {
      expect(after.reason.kind).toBe('hash-mismatch')
      if (after.reason.kind === 'hash-mismatch') {
        expect(after.reason.failingFile).toBe('tokenizer.json')
      }
    }
  })
})

describe('reducer — failed state', () => {
  it('retry from failed { card-fetch-failed } returns to card-fetch', () => {
    const before: DialogState = {
      kind: 'failed',
      meta: sampleMeta,
      reason: { kind: 'card-fetch-failed', message: 'network' },
    }
    const after = reducer(before, { type: 'retry' })
    expect(after.kind).toBe('card-fetch')
  })

  it('close from failed stays in failed (terminal — container resolves)', () => {
    const before: DialogState = {
      kind: 'failed',
      meta: sampleMeta,
      reason: { kind: 'hash-mismatch', failingFile: 'x' },
    }
    const after = reducer(before, { type: 'close' })
    expect(after.kind).toBe('failed')
  })
})
