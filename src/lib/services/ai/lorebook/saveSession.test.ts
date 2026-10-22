import { describe, it, expect, vi } from 'vitest'
import type { Entry } from '#lib/types/index.ts'
import { ActivityRecorder } from '#lib/services/activity/index.ts'
import { saveLoreSession } from './saveSession'

const entry = (id: string, name: string) => ({ id, name }) as Entry

const session = () => ({
  createdEntries: [entry('new', 'Harbor Master Ilsa')],
  updatedEntries: [entry('e1', 'The Ferry')],
  merges: [
    { sources: [entry('d1', 'Docks'), entry('d2', 'Old Docks')], merged: entry('m', 'Old Docks') },
  ],
  deletedEntries: [entry('d1', 'Docks'), entry('x', 'Stale Rumour')],
})

const writes = () => ({ onSaveSession: vi.fn(async () => {}) })

function recorded() {
  const recorder = new ActivityRecorder()
  recorder.setReporting('tree')
  recorder.startTurn('entry')
  const parent = recorder.startStep('Lore management')
  return { recorder, parent, steps: () => recorder.activeTurn!.steps.slice(1) }
}

describe('saveLoreSession', () => {
  it('hands the whole session over in one write, under one saving step', async () => {
    const { recorder, parent, steps } = recorded()
    const callbacks = writes()

    const changes = await saveLoreSession(session(), 'b1', callbacks, recorder, parent)

    expect(callbacks.onSaveSession).toHaveBeenCalledTimes(1)
    const [saved] = callbacks.onSaveSession.mock.calls[0] as unknown as [
      { creates: Entry[]; updates: Entry[]; merges: { sourceIds: string[] }[]; deletes: string[] },
    ]
    expect(saved.creates[0]).toMatchObject({ name: 'Harbor Master Ilsa', branchId: 'b1' })
    expect(saved.creates[0].id).not.toBe('new')
    expect(saved.updates.map((e) => e.id)).toEqual(['e1'])
    expect(saved.merges.map((m) => m.sourceIds)).toEqual([['d1', 'd2']])
    // A source merged away is not deleted a second time.
    expect(saved.deletes).toEqual(['x'])

    expect(steps()).toEqual([
      expect.objectContaining({
        label: 'Saving changes',
        parentId: parent,
        status: 'done',
        detail: '4 changes',
      }),
    ])
    expect(changes.map((c) => c.type)).toEqual(['create', 'update', 'merge', 'delete'])
  })

  it('fails the saving step with the reason when the write fails', async () => {
    const { recorder, parent, steps } = recorded()
    const callbacks = writes()
    callbacks.onSaveSession.mockRejectedValueOnce(new Error('database is locked'))

    await expect(saveLoreSession(session(), null, callbacks, recorder, parent)).rejects.toThrow()

    expect(steps()).toEqual([
      expect.objectContaining({ status: 'failed', error: 'database is locked' }),
    ])
  })

  it('writes and records nothing with nothing to write', async () => {
    const { recorder, parent, steps } = recorded()
    const callbacks = writes()
    const empty = { createdEntries: [], updatedEntries: [], merges: [], deletedEntries: [] }

    expect(await saveLoreSession(empty, null, callbacks, recorder, parent)).toEqual([])
    expect(callbacks.onSaveSession).not.toHaveBeenCalled()
    expect(steps()).toEqual([])
  })

  it('records nothing without a parent', async () => {
    const { recorder, steps } = recorded()

    await saveLoreSession(session(), null, writes(), recorder)

    expect(steps()).toEqual([])
  })
})
