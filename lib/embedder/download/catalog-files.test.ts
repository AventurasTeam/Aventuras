import { describe, expect, it } from 'vitest'

import { getCatalogEntry } from '../catalog'
import {
  buildDownloadPlan,
  findPlanRow,
  modelMetaFromCatalogEntry,
  toDialogCatalogEntry,
} from './catalog-files'

const gemma = getCatalogEntry('onnx-community/embeddinggemma-300m-ONNX')
if (!gemma) throw new Error('fixture missing: onnx-community/embeddinggemma-300m-ONNX')

const minilm = getCatalogEntry('Xenova/all-MiniLM-L6-v2')
if (!minilm) throw new Error('fixture missing: Xenova/all-MiniLM-L6-v2')

describe('buildDownloadPlan', () => {
  it('builds one row per file in the Gemma entry, incl. config.json + the weights sidecar', () => {
    const plan = buildDownloadPlan(gemma)
    expect(plan).toHaveLength(5)
    expect(plan.map((row) => row.fileName).sort()).toEqual(
      [
        'model.onnx',
        'model_quantized.onnx_data',
        'config.json',
        'tokenizer.json',
        'tokenizer_config.json',
      ].sort(),
    )
  })

  it('preserves the files-map insertion order', () => {
    const plan = buildDownloadPlan(gemma)
    expect(plan.map((row) => row.fileName)).toEqual(Object.keys(gemma.files))
  })

  it('resolves each url against the pinned huggingfaceRevision and repo path', () => {
    const plan = buildDownloadPlan(gemma)
    const model = plan.find((row) => row.fileName === 'model.onnx')
    expect(model?.url).toBe(
      `https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/${gemma.huggingfaceRevision}/onnx/model_quantized.onnx`,
    )
    const config = plan.find((row) => row.fileName === 'config.json')
    expect(config?.url).toBe(
      `https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/${gemma.huggingfaceRevision}/config.json`,
    )
  })

  it('attaches the catalog expectedSha256 for each file', () => {
    const plan = buildDownloadPlan(gemma)
    for (const row of plan) {
      expect(row.expectedSha256).toBe(gemma.expectedSha256[row.fileName])
      expect(row.expectedSha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('carries the HF repo-relative path separately from the canonical file name', () => {
    const plan = buildDownloadPlan(gemma)
    const sidecar = plan.find((row) => row.fileName === 'model_quantized.onnx_data')
    expect(sidecar?.repoPath).toBe('onnx/model_quantized.onnx_data')
  })
})

describe('toDialogCatalogEntry', () => {
  it('maps the catalog entry onto the dialog machine CatalogEntry shape', () => {
    const entry = toDialogCatalogEntry(minilm)
    expect(entry.id).toBe(minilm.id)
    expect(entry.displayName).toBe(minilm.displayName)
    expect(entry.revision).toBe(minilm.huggingfaceRevision)
    expect(entry.sizeBytes).toBe(minilm.size_bytes)
    expect(entry.source).toBe(`https://huggingface.co/${minilm.id}`)
  })

  it('files is the ordered list of repo-relative paths, matching buildDownloadPlan', () => {
    const plan = buildDownloadPlan(minilm)
    const entry = toDialogCatalogEntry(minilm)
    expect(entry.files).toEqual(plan.map((row) => row.repoPath))
  })

  it('expectedSha256 is keyed by repo-relative path (matching `files`), not canonical name', () => {
    const entry = toDialogCatalogEntry(gemma)
    const sidecarRepoPath = 'onnx/model_quantized.onnx_data'
    expect(entry.files).toContain(sidecarRepoPath)
    expect(entry.expectedSha256[sidecarRepoPath]).toBe(
      gemma.expectedSha256['model_quantized.onnx_data'],
    )
  })

  it('round-trips through the same URL buildDownloadPlan computes (source + revision + file)', () => {
    const plan = buildDownloadPlan(gemma)
    const entry = toDialogCatalogEntry(gemma)
    for (const file of entry.files) {
      const built = `${entry.source}/resolve/${entry.revision}/${file}`
      expect(plan.some((row) => row.url === built)).toBe(true)
    }
  })
})

describe('modelMetaFromCatalogEntry', () => {
  it('derives ModelMeta fields straight from the dialog CatalogEntry', () => {
    const entry = toDialogCatalogEntry(gemma)
    const meta = modelMetaFromCatalogEntry(entry)
    expect(meta).toEqual({
      displayName: entry.displayName,
      source: entry.source,
      revision: entry.revision,
      sizeBytes: entry.sizeBytes,
      fileCount: entry.files.length,
    })
  })
})

describe('findPlanRow', () => {
  it('matches by exact url first', () => {
    const plan = buildDownloadPlan(minilm)
    const target = plan[1]
    const row = findPlanRow(plan, { url: target.url, targetPath: 'irrelevant' })
    expect(row).toBe(target)
  })

  it('falls back to an exact repoPath match on targetPath', () => {
    const plan = buildDownloadPlan(minilm)
    const target = plan[0]
    const row = findPlanRow(plan, {
      url: 'https://example.invalid/nope',
      targetPath: target.repoPath,
    })
    expect(row).toBe(target)
  })

  it('falls back to a basename match as a last resort', () => {
    const plan = buildDownloadPlan(minilm)
    const target = plan.find((row) => row.fileName === 'tokenizer.json')
    if (!target) throw new Error('fixture missing tokenizer.json row')
    const row = findPlanRow(plan, {
      url: 'https://example.invalid/nope',
      targetPath: '/some/other/tokenizer.json',
    })
    expect(row).toBe(target)
  })

  it('throws when nothing matches', () => {
    const plan = buildDownloadPlan(minilm)
    expect(() =>
      findPlanRow(plan, { url: 'https://example.invalid/nope', targetPath: 'nope.bin' }),
    ).toThrow()
  })
})
