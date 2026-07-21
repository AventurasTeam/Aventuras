import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CatalogEntry } from '@/components/compounds/embedder-download-dialog-machine'

import { fetchModelCard, resolveHfModel } from './model-card'

const entry: CatalogEntry = {
  id: 'Xenova/all-MiniLM-L6-v2',
  displayName: 'MiniLM-L6 (lightweight)',
  source: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2',
  revision: 'abc123def456',
  sizeBytes: 25_000_000,
  files: ['model.onnx', 'tokenizer.json', 'tokenizer_config.json'],
  expectedSha256: { 'model.onnx': 'aaa', 'tokenizer.json': 'bbb', 'tokenizer_config.json': 'ccc' },
}

const README = `---
license: apache-2.0
tags:
  - sentence-similarity
---

# MiniLM-L6

Apache 2.0 licensed. Some model-card body text.
`

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function textResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, { status: 200, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchModelCard — catalog path', () => {
  it('builds ModelMeta from the catalog entry, not the API response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/models/'))
          return jsonResponse({ cardData: { license: 'apache-2.0' } })
        return textResponse(README)
      }),
    )

    const result = await fetchModelCard({ kind: 'catalog', entry })

    expect(result.meta).toEqual({
      displayName: entry.displayName,
      source: entry.source,
      revision: entry.revision,
      sizeBytes: entry.sizeBytes,
      fileCount: entry.files.length,
    })
  })

  it('takes licenseName from cardData.license and licenseText from the README with frontmatter stripped', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/models/'))
          return jsonResponse({ cardData: { license: 'apache-2.0' } })
        return textResponse(README)
      }),
    )

    const result = await fetchModelCard({ kind: 'catalog', entry })

    expect(result.licenseName).toBe('apache-2.0')
    expect(result.licenseText).not.toMatch(/^---/)
    expect(result.licenseText).not.toContain('license: apache-2.0')
    expect(result.licenseText).toContain('# MiniLM-L6')
    expect(result.licenseText).toContain('Apache 2.0 licensed.')
  })

  it('licenseName is empty when the model card has no declared license', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/models/')) return jsonResponse({})
        return textResponse(README)
      }),
    )

    const result = await fetchModelCard({ kind: 'catalog', entry })
    expect(result.licenseName).toBe('')
  })

  it('requests the pinned revision, not a floating ref', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/models/')) return jsonResponse({ cardData: {} })
      return textResponse(README)
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchModelCard({ kind: 'catalog', entry })

    const urls = fetchMock.mock.calls.map(([url]: [string]) => url)
    expect(urls).toEqual(
      expect.arrayContaining([
        `https://huggingface.co/api/models/${entry.id}/revision/${entry.revision}`,
        `https://huggingface.co/${entry.id}/raw/${entry.revision}/README.md`,
      ]),
    )
  })

  it('rejects with a useful message on a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/models/')) return new Response('not found', { status: 404 })
        return textResponse(README)
      }),
    )

    await expect(fetchModelCard({ kind: 'catalog', entry })).rejects.toThrow(/404/)
  })

  it('propagates a network rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    await expect(fetchModelCard({ kind: 'catalog', entry })).rejects.toThrow(/Failed to fetch/)
  })
})

describe('fetchModelCard — hf-id path', () => {
  it('rejects — the power-user HF-id path lands in M7.1', async () => {
    await expect(fetchModelCard({ kind: 'hf-id', id: 'foo/bar' })).rejects.toThrow(/M7\.1/)
  })
})

describe('resolveHfModel', () => {
  it('rejects — the power-user HF-id path lands in M7.1', async () => {
    await expect(resolveHfModel()).rejects.toThrow(/M7\.1/)
  })
})
