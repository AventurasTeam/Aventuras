import { describe, expect, it, vi } from 'vitest'

import { createEditRequests } from './edit-bridge-requests'
import { nativeEditPort, webEditPort, type EditDocumentHandle } from './inline-edit-port'
import type { ReaderSurfaceHandle } from './reader-document-types'

function surface(over: Partial<ReaderSurfaceHandle> = {}): ReaderSurfaceHandle {
  return {
    jumpToBottom: vi.fn(),
    jumpToEntry: vi.fn(),
    editSession: vi.fn(() => ({ entryId: 'e2', dirty: true })),
    commitDraft: vi.fn(async () => ({ ok: true as const })),
    discardDraft: vi.fn(),
    ...over,
  }
}

describe('webEditPort', () => {
  it("reads, commits and discards through the surface's handle", async () => {
    const handle = surface()
    const port = webEditPort(() => handle)
    await expect(port.query()).resolves.toEqual({ entryId: 'e2', dirty: true })
    await expect(port.commit()).resolves.toEqual({ ok: true })
    port.discard()
    expect(handle.discardDraft).toHaveBeenCalledOnce()
  })

  it('counts an unmounted surface as no editor', async () => {
    const port = webEditPort(() => null)
    await expect(port.query()).resolves.toBeNull()
    await expect(port.commit()).resolves.toEqual({ ok: true })
  })
})

describe('nativeEditPort', () => {
  function documentAnswering(requests: ReturnType<typeof createEditRequests>) {
    const handle: EditDocumentHandle = {
      queryEditSession: vi.fn((id: string) =>
        requests.answer(id, { kind: 'query', session: { entryId: 'e2', dirty: true } }),
      ),
      commitDraft: vi.fn((id: string) =>
        requests.answer(id, { kind: 'commit', result: { ok: false, code: 'not-found' } }),
      ),
      discardDraft: vi.fn(),
    }
    return handle
  }

  it('asks the document and resolves with its answer', async () => {
    const requests = createEditRequests({ queryTimeoutMs: 50, commitTimeoutMs: 50 })
    const handle = documentAnswering(requests)
    const port = nativeEditPort(requests, () => handle)
    await expect(port.query()).resolves.toEqual({ entryId: 'e2', dirty: true })
    await expect(port.commit()).resolves.toEqual({ ok: false, code: 'not-found' })
    port.discard()
    expect(handle.discardDraft).toHaveBeenCalledOnce()
  })

  it('reads unresponsive when the document has no handle registered', async () => {
    const requests = createEditRequests({ queryTimeoutMs: 1, commitTimeoutMs: 1 })
    const port = nativeEditPort(requests, () => ({}))
    await expect(port.query()).resolves.toBe('unresponsive')
    await expect(port.commit()).resolves.toBe('unresponsive')
    expect(() => port.discard()).not.toThrow()
  })

  it('resolves a waiting query as no editor when the document boots', async () => {
    const requests = createEditRequests({ queryTimeoutMs: 10_000, commitTimeoutMs: 10_000 })
    const port = nativeEditPort(requests, () => ({ queryEditSession: () => {} }))
    const asked = port.query()
    requests.resetAll()
    await expect(asked).resolves.toBeNull()
  })
})
