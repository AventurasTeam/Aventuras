// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChapterSaveResult } from '@/lib/actions'
import type { StoreChapter } from '@/lib/stores'

import { useTimelineEditing, type TimelineEditingOptions } from './use-timeline-editing'

// Navigation and the window-close bridge have their own tests; this file pins the composition.
vi.mock('@/hooks/use-surface-navigate', () => ({ useSurfaceNavigate: () => vi.fn() }))
vi.mock('@/hooks/use-unsaved-changes-guard', () => ({ useUnsavedChangesGuard: () => {} }))

function chapter(sequenceNumber: number): StoreChapter {
  return {
    id: `chap_${sequenceNumber}`,
    branchId: 'br_1',
    sequenceNumber,
    title: `Chapter ${sequenceNumber}`,
    summary: `What happened in chapter ${sequenceNumber}.`,
    theme: '',
    keywords: [],
    startEntryId: `entry_${sequenceNumber}_start`,
    endEntryId: `entry_${sequenceNumber}_end`,
    tokenCount: 1_000,
    closedAt: 0,
    embeddingStale: 0,
    createdAt: 0,
    updatedAt: 0,
    hasCloseReport: false,
  }
}

const ONE = chapter(1)
const TWO = chapter(2)
const THREE = chapter(3)
const BEFORE = [ONE, TWO]
const AFTER = [ONE, TWO, THREE]

type Props = Pick<TimelineEditingOptions, 'ready' | 'rows' | 'runInFlight'>

function setup(initialProps: Props = { ready: true, rows: BEFORE, runInFlight: false }) {
  const save = vi.fn(
    async (row: StoreChapter): Promise<ChapterSaveResult> => ({ status: 'ok', id: row.id }),
  )
  const hook = renderHook(
    (props: Props) => useTimelineEditing({ ...props, save, onSaved: vi.fn(), onRejected: vi.fn() }),
    { initialProps },
  )
  return hook
}

type Hook = ReturnType<typeof setup>

function open(hook: Hook, id: string) {
  act(() => hook.result.current.toggle(id))
  expect(hook.result.current.expandedId).toBe(id)
}

/** A close lands mid-run, then the run ends. */
function closeLands(hook: Hook) {
  hook.rerender({ ready: true, rows: BEFORE, runInFlight: true })
  hook.rerender({ ready: true, rows: AFTER, runInFlight: true })
  hook.rerender({ ready: true, rows: AFTER, runInFlight: false })
}

afterEach(cleanup)

describe('useTimelineEditing', () => {
  it('keeps a dirty card open, with its draft, when a close lands and its run ends', async () => {
    const hook = setup()
    open(hook, ONE.id)
    act(() =>
      hook.result.current.session.form.setValue('title', 'Chapter 1, revised', {
        shouldDirty: true,
      }),
    )
    await waitFor(() => expect(hook.result.current.session.dirty).toBe(true))

    closeLands(hook)
    expect(hook.result.current.expandedId).toBe(ONE.id)
    expect(hook.result.current.session.form.getValues('title')).toBe('Chapter 1, revised')
    expect(hook.result.current.session.dirty).toBe(true)
  })

  it('moves a clean card aside for the close that lands', () => {
    const hook = setup()
    open(hook, ONE.id)
    closeLands(hook)
    expect(hook.result.current.expandedId).toBe(THREE.id)
    expect(hook.result.current.session.form.getValues('title')).toBe(THREE.title)
  })

  it('holds a close that lands mid-run until the run ends', () => {
    const hook = setup()
    open(hook, ONE.id)
    hook.rerender({ ready: true, rows: AFTER, runInFlight: true })
    expect(hook.result.current.expandedId).toBe(ONE.id)
    hook.rerender({ ready: true, rows: AFTER, runInFlight: false })
    expect(hook.result.current.expandedId).toBe(THREE.id)
  })

  it('opens nothing for the chapters a cold open hydrates', () => {
    const hook = setup({ ready: false, rows: [], runInFlight: false })
    hook.rerender({ ready: true, rows: AFTER, runInFlight: false })
    expect(hook.result.current.expandedId).toBeNull()
  })
})
