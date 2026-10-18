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

const writes = () => ({
  onCreateEntry: vi.fn(async () => {}),
  onUpdateEntry: vi.fn(async () => {}),
  onDeleteEntry: vi.fn(async () => {}),
  onMergeEntries: vi.fn(async () => {}),
})

function recorded() {
  const recorder = new ActivityRecorder()
  recorder.setReporting('tree')
  recorder.startTurn('entry')
  const parent = recorder.startStep('Lore management')
  return { recorder, parent, steps: () => recorder.activeTurn!.steps.slice(1) }
}

describe('saveLoreSession', () => {
  it('records one step per write in order, under a saving step', async () => {
    const { recorder, parent, steps } = recorded()

    const changes = await saveLoreSession(session(), null, writes(), recorder, parent)

    const [saving, ...written] = steps()
    expect(saving).toMatchObject({
      label: 'Saving changes',
      parentId: parent,
      status: 'done',
      detail: '4 changes',
    })
    expect(written.map((s) => [s.label, s.parentId, s.status])).toEqual([
      ['Created "Harbor Master Ilsa"', saving.id, 'done'],
      ['Updated "The Ferry"', saving.id, 'done'],
      ['Merged 2 into "Old Docks"', saving.id, 'done'],
      ['Deleted "Stale Rumour"', saving.id, 'done'],
    ])
    expect(changes.map((c) => c.type)).toEqual(['create', 'update', 'merge', 'delete'])
  })

  it('fails the write and the saving step with the reason, and stops there', async () => {
    const { recorder, parent, steps } = recorded()
    const callbacks = writes()
    callbacks.onUpdateEntry.mockRejectedValueOnce(new Error('refusing to update entry e1'))

    await expect(saveLoreSession(session(), null, callbacks, recorder, parent)).rejects.toThrow()

    const [saving, created, updated] = steps()
    expect(saving).toMatchObject({ status: 'failed', error: 'refusing to update entry e1' })
    expect(created.status).toBe('done')
    expect(updated).toMatchObject({ status: 'failed', error: 'refusing to update entry e1' })
    expect(steps()).toHaveLength(3)
    expect(callbacks.onMergeEntries).not.toHaveBeenCalled()
  })

  it('records nothing with nothing to write', async () => {
    const { recorder, parent, steps } = recorded()
    const empty = { createdEntries: [], updatedEntries: [], merges: [], deletedEntries: [] }

    expect(await saveLoreSession(empty, null, writes(), recorder, parent)).toEqual([])
    expect(steps()).toEqual([])
  })

  it('records nothing without a parent', async () => {
    const { recorder, steps } = recorded()

    await saveLoreSession(session(), null, writes(), recorder)

    expect(steps()).toEqual([])
  })
})
