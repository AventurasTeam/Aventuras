// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Entity, StoryEntry } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import { useSceneEditing } from './scene-editing'

const updateEntrySceneFields = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ status: string; reason?: string; code?: string }>>(),
)

vi.mock('@/lib/actions', () => ({ updateEntrySceneFields }))

const CTX = {} as never

function entry(id: string, position: number, sceneEntities: string[] | null): StoryEntry {
  return {
    id,
    branchId: 'b1',
    chapterId: null,
    kind: 'ai_reply',
    content: 'x',
    position,
    createdAt: 0,
    metadata:
      sceneEntities == null ? null : { sceneEntities, currentLocationId: 'loc_a', worldTime: 60 },
  } as StoryEntry
}

const ENTITIES = [
  { id: 'char_a', kind: 'character', name: 'Aria' },
  { id: 'item_a', kind: 'item', name: 'Sword' },
  { id: 'loc_a', kind: 'location', name: 'The Keep' },
] as unknown as Entity[]

const ENTRIES = [entry('e1', 1, ['char_a']), entry('e2', 2, ['char_a'])]

beforeEach(() => {
  updateEntrySceneFields.mockReset()
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
  vi.spyOn(logger, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  // `logger` is a singleton: a spy left on it accumulates calls across tests, so a
  // later assertion can be satisfied by an earlier test's call.
  vi.restoreAllMocks()
})

function render(entries: StoryEntry[], entities: readonly Entity[] = ENTITIES) {
  return renderHook(
    ({ rows }: { rows: StoryEntry[] }) => useSceneEditing('b1', rows, entities, CTX),
    { initialProps: { rows: entries } },
  )
}

describe('useSceneEditing → resolution pools', () => {
  it('resolves every entity, not just scene members', () => {
    // A transfer counterparty and a rejected location sit outside the scene; scoping
    // the pool to members would render them as unknown.
    const { result } = render(ENTRIES)
    expect(result.current.entityNames).toEqual([
      { id: 'char_a', name: 'Aria' },
      { id: 'item_a', name: 'Sword' },
      { id: 'loc_a', name: 'The Keep' },
    ])
  })

  it('splits the editor candidates by kind', () => {
    const { result } = render(ENTRIES)
    expect(result.current.sceneOptions).toEqual({
      characters: [{ id: 'char_a', name: 'Aria' }],
      items: [{ id: 'item_a', name: 'Sword' }],
      locations: [{ id: 'loc_a', name: 'The Keep' }],
    })
  })
})

describe('useSceneEditing → tail rule', () => {
  it('reads the tail off the end of the ascending rows', () => {
    const { result } = render(ENTRIES)
    expect(result.current.tailEntryId).toBe('e2')
  })

  it('has no tail on an empty branch', () => {
    const { result } = render([])
    expect(result.current.tailEntryId).toBeNull()
  })

  it('reads past a system entry to the narrative tail', () => {
    const failure = { ...entry('e_sys', 3, []), kind: 'system' } as StoryEntry
    const { result } = render([...ENTRIES, failure])
    // A failure banner is a diagnostic singleton, not narrative state: it must not
    // take the scene editor off the entry the branch actually ends on.
    expect(result.current.tailEntryId).toBe('e2')
  })

  it('has no tail on a branch holding nothing but a system entry', () => {
    const failure = { ...entry('e_sys', 1, []), kind: 'system' } as StoryEntry
    const { result } = render([failure])
    expect(result.current.tailEntryId).toBeNull()
  })
})

describe('useSceneEditing → stale edit target', () => {
  it('drops the pending id when the entry disappears', () => {
    const { result, rerender } = render(ENTRIES)

    act(() => result.current.requestEditScene('e2'))
    expect(result.current.sceneEdit?.entryId).toBe('e2')

    // A rollback / branch switch takes the entry out from under the open sheet.
    act(() => rerender({ rows: [ENTRIES[0]] }))
    expect(result.current.sceneEdit).toBeNull()

    // The id is gone, not merely hidden: bringing the entry back — as a redo does —
    // must not resurrect the overlay.
    act(() => rerender({ rows: ENTRIES }))
    expect(result.current.sceneEdit).toBeNull()
  })

  // No analogue in the world-time editor: only the scene editor is tail-restricted, so
  // a new turn arriving under an open sheet makes its target unsaveable.
  it('closes the overlay when a new turn moves the tail off the target', () => {
    const { result, rerender } = render(ENTRIES)

    act(() => result.current.requestEditScene('e2'))
    expect(result.current.sceneEdit?.entryId).toBe('e2')

    act(() => rerender({ rows: [...ENTRIES, entry('e3', 3, ['char_a'])] }))
    expect(result.current.sceneEdit).toBeNull()
  })

  it('opens nothing for an entry that carries no metadata', () => {
    const rows = [entry('e1', 1, ['char_a']), entry('e2', 2, null)]
    const { result } = render(rows)

    act(() => result.current.requestEditScene('e2'))
    // There is no absolute triple to seed the form with.
    expect(result.current.sceneEdit).toBeNull()
  })

  it('closes on request', () => {
    const { result } = render(ENTRIES)
    act(() => result.current.requestEditScene('e2'))
    expect(result.current.sceneEdit).not.toBeNull()
    act(() => result.current.closeSceneEdit())
    expect(result.current.sceneEdit).toBeNull()
  })
})

describe('useSceneEditing → edit result channel', () => {
  const NEXT = { sceneEntities: ['char_a'], currentLocationId: 'loc_a' }

  it('reports a rejection as a result carrying its code', async () => {
    updateEntrySceneFields.mockResolvedValue({
      status: 'rejected',
      reason: 'not the tail',
      code: 'not-tail-entry',
    })
    const { result } = render(ENTRIES)
    // Never the rejection channel: on native the expo-dom bridge re-rejects into the
    // WebView's own realm, so an escaped rejection would leave Save inert.
    await expect(result.current.editScene('e2', NEXT)).resolves.toEqual({
      ok: false,
      code: 'not-tail-entry',
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'action_layer.scene_edit_rejected',
      expect.objectContaining({ entryId: 'e2', code: 'not-tail-entry' }),
    )
  })

  it('reports a thrown write as a result', async () => {
    updateEntrySceneFields.mockRejectedValue(new Error('database is locked'))
    const { result } = render(ENTRIES)
    await expect(result.current.editScene('e2', NEXT)).resolves.toEqual({ ok: false })
    // A throw is a different diagnostic from a rejection: error, not warn.
    expect(logger.error).toHaveBeenCalledWith(
      'action_layer.scene_edit_failed',
      expect.objectContaining({ entryId: 'e2', error: 'database is locked' }),
    )
  })

  it('reports a successful write as ok and stays quiet', async () => {
    updateEntrySceneFields.mockResolvedValue({ status: 'ok' })
    const { result } = render(ENTRIES)
    await expect(result.current.editScene('e2', NEXT)).resolves.toEqual({ ok: true })
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })
})
