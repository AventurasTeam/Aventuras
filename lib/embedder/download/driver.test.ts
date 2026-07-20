import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EmbedderBridge, EmbedderDownloadProgress } from '@/types/embedder-bridge'

import { getCatalogEntry } from '../catalog'
import { buildDownloadPlan } from './catalog-files'
import { createEmbedderDownloadDriver } from './driver'

const entry = getCatalogEntry('Xenova/all-MiniLM-L6-v2')
if (!entry) throw new Error('fixture missing: Xenova/all-MiniLM-L6-v2')

const plan = buildDownloadPlan(entry)
const modelRow = plan.find((row) => row.fileName === 'model.onnx')
if (!modelRow) throw new Error('fixture missing model.onnx row')

function makeBridge(overrides: Partial<EmbedderBridge> = {}): EmbedderBridge {
  return {
    embed: vi.fn(),
    smokeTest: vi.fn(async () => ({ ok: true, dim: 384 }) as const),
    listInstalled: vi.fn(async () => []),
    downloadFile: vi.fn(async () => ({ ok: true }) as const),
    persistInstall: vi.fn(async () => undefined),
    deletePartial: vi.fn(async () => undefined),
    embeddersRoot: vi.fn(async () => '/tmp/embedders'),
    onDownloadProgress: vi.fn(() => () => {}),
    ...overrides,
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createEmbedderDownloadDriver — downloadFile', () => {
  it('routes to the bridge with the modelId/fileName/hash resolved from the plan', async () => {
    const bridge = makeBridge()
    vi.stubGlobal('window', { aventurasEmbedder: bridge })
    const driver = createEmbedderDownloadDriver(entry)

    await driver.downloadFile({
      url: modelRow.url,
      targetPath: modelRow.repoPath,
      onProgress: vi.fn(),
    })

    expect(bridge.downloadFile).toHaveBeenCalledWith({
      url: modelRow.url,
      modelId: entry.id,
      fileName: 'model.onnx',
      expectedSha256: modelRow.expectedSha256,
    })
  })

  it('resolves the plan row via targetPath even when the caller-supplied url is bogus', async () => {
    const bridge = makeBridge()
    vi.stubGlobal('window', { aventurasEmbedder: bridge })
    const driver = createEmbedderDownloadDriver(entry)

    await driver.downloadFile({
      url: 'huggingface.co/not-a-scheme/resolve/x/model.onnx',
      targetPath: modelRow.repoPath,
      onProgress: vi.fn(),
    })

    expect(bridge.downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ url: modelRow.url, fileName: 'model.onnx' }),
    )
  })

  it('throws on a network/disk failure, routing through the generic download-failed path', async () => {
    const bridge = makeBridge({
      downloadFile: vi.fn(async () => ({ ok: false, reason: 'network', message: 'boom' }) as const),
    })
    vi.stubGlobal('window', { aventurasEmbedder: bridge })
    const driver = createEmbedderDownloadDriver(entry)

    await expect(
      driver.downloadFile({
        url: modelRow.url,
        targetPath: modelRow.repoPath,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow('boom')
  })

  it('resolves (does not throw) on a hash-mismatch, deferring the failure to computeSha256', async () => {
    const bridge = makeBridge({
      downloadFile: vi.fn(
        async () => ({ ok: false, reason: 'hash-mismatch', message: 'sha mismatch' }) as const,
      ),
    })
    vi.stubGlobal('window', { aventurasEmbedder: bridge })
    const driver = createEmbedderDownloadDriver(entry)

    await expect(
      driver.downloadFile({
        url: modelRow.url,
        targetPath: modelRow.repoPath,
        onProgress: vi.fn(),
      }),
    ).resolves.toBeUndefined()
  })

  it('subscribes before calling the bridge, filters by modelId+fileName, forwards bytes, and unsubscribes', async () => {
    let emit: ((progress: EmbedderDownloadProgress) => void) | undefined
    const unsubscribe = vi.fn()

    const bridge = makeBridge({
      onDownloadProgress: vi.fn((cb) => {
        emit = cb
        return unsubscribe
      }),
      downloadFile: vi.fn(async () => {
        // A second file's events (different fileName) must be filtered out.
        emit?.({ modelId: entry.id, fileName: 'tokenizer.json', bytesReceived: 5, bytesTotal: 5 })
        emit?.({ modelId: entry.id, fileName: 'model.onnx', bytesReceived: 10, bytesTotal: 100 })
        emit?.({ modelId: entry.id, fileName: 'model.onnx', bytesReceived: 100, bytesTotal: 100 })
        return { ok: true } as const
      }),
    })
    vi.stubGlobal('window', { aventurasEmbedder: bridge })
    const driver = createEmbedderDownloadDriver(entry)
    const onProgress = vi.fn()

    await driver.downloadFile({ url: modelRow.url, targetPath: modelRow.repoPath, onProgress })

    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenNthCalledWith(1, 10, 100)
    expect(onProgress).toHaveBeenNthCalledWith(2, 100, 100)
    expect(bridge.onDownloadProgress).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('createEmbedderDownloadDriver — computeSha256', () => {
  it('echoes the plan expectedSha256 for a file that downloaded cleanly', async () => {
    const bridge = makeBridge()
    vi.stubGlobal('window', { aventurasEmbedder: bridge })
    const driver = createEmbedderDownloadDriver(entry)

    await driver.downloadFile({
      url: modelRow.url,
      targetPath: modelRow.repoPath,
      onProgress: vi.fn(),
    })
    await expect(driver.computeSha256(modelRow.repoPath)).resolves.toBe(modelRow.expectedSha256)
  })

  it('throws for a file whose download reported a hash-mismatch, surfacing the verify-failed path', async () => {
    const bridge = makeBridge({
      downloadFile: vi.fn(
        async () => ({ ok: false, reason: 'hash-mismatch', message: 'sha mismatch' }) as const,
      ),
    })
    vi.stubGlobal('window', { aventurasEmbedder: bridge })
    const driver = createEmbedderDownloadDriver(entry)

    await driver.downloadFile({
      url: modelRow.url,
      targetPath: modelRow.repoPath,
      onProgress: vi.fn(),
    })
    await expect(driver.computeSha256(modelRow.repoPath)).rejects.toThrow(/mismatch/)
  })
})

describe('createEmbedderDownloadDriver — smokeTestEmbed', () => {
  it('resolves when the bridge smoke-test succeeds', async () => {
    const bridge = makeBridge({ smokeTest: vi.fn(async () => ({ ok: true, dim: 384 }) as const) })
    vi.stubGlobal('window', { aventurasEmbedder: bridge })
    const driver = createEmbedderDownloadDriver(entry)

    await expect(
      driver.smokeTestEmbed({ modelDir: '/tmp/model', ep: 'cpu' }),
    ).resolves.toBeUndefined()
  })

  it('throws with the bridge error message on smoke-test failure', async () => {
    const bridge = makeBridge({
      smokeTest: vi.fn(
        async () => ({ ok: false, error: { kind: 'call', message: 'crashed' } }) as const,
      ),
    })
    vi.stubGlobal('window', { aventurasEmbedder: bridge })
    const driver = createEmbedderDownloadDriver(entry)

    await expect(driver.smokeTestEmbed({ modelDir: '/tmp/model', ep: 'cpu' })).rejects.toThrow(
      'crashed',
    )
  })
})

describe('createEmbedderDownloadDriver — persistInstall', () => {
  it('computes licenseSha256 via crypto.subtle and passes the full attestation', async () => {
    const bridge = makeBridge()
    vi.stubGlobal('window', { aventurasEmbedder: bridge })
    const driver = createEmbedderDownloadDriver(entry)

    const licenseText = 'MIT License\n\nPermission is hereby granted...'
    const meta = {
      displayName: entry.displayName,
      source: `https://huggingface.co/${entry.id}`,
      revision: entry.huggingfaceRevision,
      sizeBytes: entry.size_bytes,
      fileCount: Object.keys(entry.files).length,
    }
    const expectedHash = await sha256Hex(licenseText)

    const before = Date.now()
    await driver.persistInstall({ meta, licenseText })
    const after = Date.now()

    expect(bridge.persistInstall).toHaveBeenCalledTimes(1)
    const call = vi.mocked(bridge.persistInstall).mock.calls[0][0]
    expect(call.modelId).toBe(entry.id)
    expect(call.licenseText).toBe(licenseText)
    expect(call.attestation.licenseSha256).toBe(expectedHash)
    expect(call.attestation.sourceUrl).toBe(meta.source)
    expect(call.attestation.revision).toBe(meta.revision)
    expect(call.attestation.timestamp).toBeGreaterThanOrEqual(before)
    expect(call.attestation.timestamp).toBeLessThanOrEqual(after)
  })
})

describe('createEmbedderDownloadDriver — deletePartial', () => {
  it('routes to the bridge with the entry id the factory closed over', async () => {
    const bridge = makeBridge()
    vi.stubGlobal('window', { aventurasEmbedder: bridge })
    const driver = createEmbedderDownloadDriver(entry)

    await driver.deletePartial('/some/unrelated/path')

    expect(bridge.deletePartial).toHaveBeenCalledWith({ modelId: entry.id })
  })
})

describe('createEmbedderDownloadDriver — resolveHfModel', () => {
  it('rejects — the power-user HF-id path lands in M7.1', async () => {
    const bridge = makeBridge()
    vi.stubGlobal('window', { aventurasEmbedder: bridge })
    const driver = createEmbedderDownloadDriver(entry)

    await expect(driver.resolveHfModel('foo/bar')).rejects.toThrow(/M7\.1/)
  })
})

describe('createEmbedderDownloadDriver — bridge unavailable', () => {
  it('throws a clear error when window.aventurasEmbedder is missing', async () => {
    vi.stubGlobal('window', {})
    const driver = createEmbedderDownloadDriver(entry)

    await expect(driver.deletePartial('/x')).rejects.toThrow(/bridge/i)
  })
})
