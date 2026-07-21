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

describe('reducer — hf-input state', () => {
  it('submit-hf-input transitions to resolving with synthetic hf-id init', () => {
    const before: DialogState = { kind: 'hf-input' }
    const after = reducer(before, { type: 'submit-hf-input', input: 'Xenova/all-MiniLM-L6-v2-q8' })
    expect(after.kind).toBe('resolving')
    if (after.kind === 'resolving') {
      expect(after.init.kind).toBe('hf-id')
      if (after.init.kind === 'hf-id') {
        expect(after.init.input).toBe('Xenova/all-MiniLM-L6-v2-q8')
      }
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
      licenseKind: 'license',
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
      licenseKind: 'license',
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
      licenseKind: 'license',
    }
    const after = reducer(before, { type: 'license-declined' })
    expect(after.kind).toBe('done')
  })
})

describe('reducer — import-confirm state', () => {
  it('license-accepted transitions import-confirm to verifying via bundleToMeta', () => {
    const before: DialogState = {
      kind: 'import-confirm',
      bundle: sampleBundle,
      pickedEp: 'cpu',
    }
    const after = reducer(before, { type: 'license-accepted' })
    expect(after.kind).toBe('verifying')
    if (after.kind === 'verifying') {
      expect(after.meta.displayName).toBe(sampleBundle.modelId)
      expect(after.meta.fileCount).toBe(sampleBundle.files.length)
      expect(Object.keys(after.verifyByFile)).toHaveLength(0)
    }
  })

  it('ep-picked stages the new EP without transitioning out of import-confirm', () => {
    const before: DialogState = {
      kind: 'import-confirm',
      bundle: sampleBundle,
      pickedEp: 'cpu',
    }
    const after = reducer(before, { type: 'ep-picked', ep: 'nnapi' })
    expect(after.kind).toBe('import-confirm')
    if (after.kind === 'import-confirm') {
      expect(after.pickedEp).toBe('nnapi')
      expect(after.bundle).toBe(sampleBundle)
    }
  })
})

describe('reducer — ep-picker state', () => {
  it('ep-picked stages the new EP without transitioning out of ep-picker', () => {
    const before: DialogState = { kind: 'ep-picker', meta: sampleMeta, pickedEp: 'cpu' }
    const after = reducer(before, { type: 'ep-picked', ep: 'coreml' })
    expect(after.kind).toBe('ep-picker')
    if (after.kind === 'ep-picker') {
      expect(after.pickedEp).toBe('coreml')
    }
  })

  it('ep-confirmed transitions ep-picker to downloading', () => {
    const before: DialogState = { kind: 'ep-picker', meta: sampleMeta, pickedEp: 'nnapi' }
    const after = reducer(before, { type: 'ep-confirmed' })
    expect(after.kind).toBe('downloading')
    if (after.kind === 'downloading') {
      expect(Object.keys(after.progressByFile)).toHaveLength(0)
    }
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

  it('download-complete marks file done, preserving bytesTotal for the running total', () => {
    const before: DialogState = {
      kind: 'downloading',
      meta: sampleMeta,
      progressByFile: {
        'model.onnx': { kind: 'downloading', bytesReceived: 25_000_000, bytesTotal: 25_000_000 },
      },
    }
    const after = reducer(before, { type: 'download-complete', file: 'model.onnx' })
    if (after.kind === 'downloading') {
      expect(after.progressByFile['model.onnx']).toEqual({ kind: 'done', bytesTotal: 25_000_000 })
    }
  })

  it('files-planned seeds every file as waiting without clobbering in-flight progress', () => {
    const before: DialogState = {
      kind: 'downloading',
      meta: sampleMeta,
      progressByFile: {
        'model.onnx': { kind: 'downloading', bytesReceived: 1_000, bytesTotal: 25_000_000 },
      },
    }
    const after = reducer(before, {
      type: 'files-planned',
      files: ['model.onnx', 'tokenizer.json', 'tokenizer_config.json'],
    })
    if (after.kind === 'downloading') {
      expect(after.progressByFile['model.onnx']).toEqual({
        kind: 'downloading',
        bytesReceived: 1_000,
        bytesTotal: 25_000_000,
      })
      expect(after.progressByFile['tokenizer.json']).toEqual({ kind: 'waiting' })
      expect(after.progressByFile['tokenizer_config.json']).toEqual({ kind: 'waiting' })
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

  it('download-failed transitions downloading to failed with download-failed reason', () => {
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
      expect(after.reason.kind).toBe('download-failed')
      if (after.reason.kind === 'download-failed') {
        expect(after.reason.failingFile).toBe('model.onnx')
        expect(after.reason.message).toBe('connection reset')
      }
    }
  })

  it('retry from download-failed restarts the downloading manifest', () => {
    const before: DialogState = {
      kind: 'failed',
      meta: sampleMeta,
      reason: { kind: 'download-failed', failingFile: 'model.onnx', message: 'connection reset' },
    }
    const after = reducer(before, { type: 'retry' })
    expect(after.kind).toBe('downloading')
    if (after.kind === 'downloading') {
      expect(after.progressByFile).toEqual({})
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

  it('persist-failed transitions to failed with persist-failed reason (persistInstall rejection)', () => {
    const before: DialogState = {
      kind: 'verifying',
      meta: sampleMeta,
      verifyByFile: { 'model.onnx': 'ok', 'tokenizer.json': 'ok' },
    }
    const after = reducer(before, { type: 'persist-failed', message: 'disk full' })
    expect(after.kind).toBe('failed')
    if (after.kind === 'failed') {
      expect(after.reason.kind).toBe('persist-failed')
      if (after.reason.kind === 'persist-failed') {
        expect(after.reason.message).toBe('disk full')
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

describe('reducer — smoke test after verification', () => {
  const verifying: DialogState = {
    kind: 'verifying',
    meta: sampleMeta,
    verifyByFile: { 'model.onnx': 'ok' },
  }

  it('routes a failed load to smoke-test-failed carrying the attempted EP', () => {
    const after = reducer(verifying, { type: 'smoke-test-failed', ep: 'nnapi' })

    expect(after).toEqual({
      kind: 'failed',
      meta: sampleMeta,
      reason: { kind: 'smoke-test-failed', ep: 'nnapi' },
    })
  })

  it('does not reach done once the load has failed', () => {
    const failed = reducer(verifying, { type: 'smoke-test-failed', ep: 'cpu' })
    expect(failed.kind).toBe('failed')
    // all-verified is only meaningful from 'verifying'; a failed state ignores it.
    expect(reducer(failed, { type: 'all-verified' }).kind).toBe('failed')
  })

  it('leaves smoke-test-failed unretryable — a rebuilt session needs a fresh download', () => {
    const failed = reducer(verifying, { type: 'smoke-test-failed', ep: 'cpu' })
    const retried = reducer(failed, { type: 'retry' })
    expect(retried.kind).toBe('failed')
  })
})

describe('reducer — verify-error vs hash-mismatch', () => {
  const verifying: DialogState = {
    kind: 'verifying',
    meta: sampleMeta,
    verifyByFile: { 'model.onnx': 'pending' },
  }

  it('a digest that was computed and differed is a hash mismatch', () => {
    const after = reducer(verifying, { type: 'verify-failed', file: 'model.onnx' })
    expect(after.kind).toBe('failed')
    if (after.kind === 'failed') expect(after.reason.kind).toBe('hash-mismatch')
  })

  it('a digest that could not be computed is a distinct, message-carrying failure', () => {
    const after = reducer(verifying, {
      type: 'verify-error',
      file: 'model.onnx',
      message: 'quick-crypto unavailable',
    })
    expect(after).toEqual({
      kind: 'failed',
      meta: sampleMeta,
      reason: {
        kind: 'verify-error',
        failingFile: 'model.onnx',
        message: 'quick-crypto unavailable',
      },
    })
  })

  it('verify-error is retryable — the bytes may be fine, the check could not run', () => {
    const failed = reducer(verifying, { type: 'verify-error', file: 'model.onnx', message: 'boom' })
    const retried = reducer(failed, { type: 'retry' })
    expect(retried.kind).toBe('downloading')
  })

  it('a genuine hash mismatch stays terminal — retrying the same bytes cannot help', () => {
    const failed = reducer(verifying, { type: 'verify-failed', file: 'model.onnx' })
    expect(reducer(failed, { type: 'retry' }).kind).toBe('failed')
  })
})
