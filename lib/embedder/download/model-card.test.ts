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

const LICENSE_MD = `---
title: Apache License 2.0
spdx-id: Apache-2.0
---

Apache License
Version 2.0, January 2004
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

/** Routes the three fetch targets; override any of them per test. */
function stubFetch(overrides?: {
  api?: () => Response | Promise<Response>
  license?: () => Response | Promise<Response>
  readme?: () => Response | Promise<Response>
}) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/api/models/')) {
      return overrides?.api?.() ?? jsonResponse({ cardData: { license: 'apache-2.0' } })
    }
    if (url.includes('/datasets/choosealicense/licenses/')) {
      return overrides?.license?.() ?? textResponse(LICENSE_MD)
    }
    return overrides?.readme?.() ?? textResponse(README)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchModelCard — catalog path', () => {
  it('builds ModelMeta from the catalog entry, not the API response', async () => {
    stubFetch()

    const result = await fetchModelCard({ kind: 'catalog', entry })

    expect(result.meta).toEqual({
      displayName: entry.displayName,
      source: entry.source,
      revision: entry.revision,
      sizeBytes: entry.sizeBytes,
      fileCount: entry.files.length,
    })
  })

  it('standard tag: renders real license text from the pinned choosealicense dataset', async () => {
    stubFetch()

    const result = await fetchModelCard({ kind: 'catalog', entry })

    expect(result.licenseKind).toBe('license')
    expect(result.licenseName).toBe('Apache License 2.0')
    expect(result.licenseText).not.toMatch(/^---/)
    expect(result.licenseText).toContain('Apache License')
    expect(result.licenseText).toContain('Version 2.0, January 2004')
    expect(result.licenseLink).toBeUndefined()
  })

  it('proprietary tag (dataset 404): falls back to the model card with frontmatter stripped', async () => {
    stubFetch({
      api: () => jsonResponse({ cardData: { license: 'gemma' } }),
      license: () => new Response('not found', { status: 404 }),
    })

    const result = await fetchModelCard({ kind: 'catalog', entry })

    expect(result.licenseKind).toBe('model-card')
    expect(result.licenseName).toBe('gemma')
    expect(result.licenseText).not.toContain('license: apache-2.0')
    expect(result.licenseText).toContain('# MiniLM-L6')
  })

  it('license:other — skips the dataset, uses license_name and carries license_link', async () => {
    const fetchMock = stubFetch({
      api: () =>
        jsonResponse({
          cardData: {
            license: 'other',
            license_name: 'acme-community',
            license_link: 'https://example.com/terms',
          },
        }),
    })

    const result = await fetchModelCard({ kind: 'catalog', entry })

    expect(result.licenseKind).toBe('model-card')
    expect(result.licenseName).toBe('acme-community')
    expect(result.licenseLink).toBe('https://example.com/terms')
    const urls = fetchMock.mock.calls.map(([url]: [string]) => url)
    expect(urls.some((u) => u.includes('choosealicense'))).toBe(false)
  })

  it('licenseName is empty when the model card has no declared license', async () => {
    stubFetch({ api: () => jsonResponse({}) })

    const result = await fetchModelCard({ kind: 'catalog', entry })
    expect(result.licenseKind).toBe('model-card')
    expect(result.licenseName).toBe('')
  })

  it('requests the pinned model revision and the pinned license-dataset revision', async () => {
    const fetchMock = stubFetch()

    await fetchModelCard({ kind: 'catalog', entry })

    const urls = fetchMock.mock.calls.map(([url]: [string]) => url)
    expect(urls).toEqual(
      expect.arrayContaining([
        `https://huggingface.co/api/models/${entry.id}/revision/${entry.revision}`,
        `https://huggingface.co/${entry.id}/raw/${entry.revision}/README.md`,
        expect.stringMatching(
          /datasets\/choosealicense\/licenses\/raw\/[0-9a-f]{40}\/markdown\/apache-2\.0\.md$/,
        ),
      ]),
    )
  })

  it('rejects when the license-dataset fetch fails with a non-404 — no silent model-card swap', async () => {
    stubFetch({ license: () => new Response('oops', { status: 500 }) })

    await expect(fetchModelCard({ kind: 'catalog', entry })).rejects.toThrow(/500/)
  })

  it('rejects with a useful message on a metadata 404', async () => {
    stubFetch({ api: () => new Response('not found', { status: 404 }) })

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
