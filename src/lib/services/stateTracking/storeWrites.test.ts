import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The store is a rune module and cannot be imported here; its source is read instead.
const source = readFileSync(
  fileURLToPath(new URL('../../stores/story.svelte.ts', import.meta.url)),
  'utf-8',
)

function bodyOf(method: string): string {
  const start = source.search(new RegExp(`\\n  (private )?(async )?${method}\\(`))
  expect(start, `${method} not found`).toBeGreaterThan(-1)
  const next = source.slice(start + 1).search(/\n  (private |get |async |[a-zA-Z]+\()/)
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next)
}

const WRITE_METHODS = [
  'addCharacter',
  'updateCharacter',
  'deleteCharacter',
  'addLocation',
  'updateLocation',
  'setCurrentLocation',
  'toggleLocationVisited',
  'deleteLocation',
  'addItem',
  'updateItem',
  'deleteItem',
  'addStoryBeat',
  'updateStoryBeat',
  'deleteStoryBeat',
  'setProtagonist',
  'addLorebookEntry',
  'addLorebookEntries',
  'updateLorebookEntry',
  'deleteLorebookEntries',
  'appendImportedLorebookEntries',
]

describe('store writes', () => {
  it.each(WRITE_METHODS)('%s records its change', (method) => {
    expect(bodyOf(method)).toContain('this.recordContext(')
  })

  it('records a generated portrait under the image origin', () => {
    expect(bodyOf('saveGeneratedPortrait')).toContain("{ origin: 'image' }")
  })

  it('records nothing while State Tracking is off', () => {
    expect(bodyOf('recordContext')).toContain('!settings.experimentalFeatures.stateTracking')
  })

  it('records the classifier as one batch with its header', () => {
    const body = bodyOf('applyClassificationResult')
    expect(body).toContain("this.recordContext({ origin: 'classifier', entryId })")
    expect(body).toContain('diffStates(')
    expect(body).not.toContain('worldStateDelta')
  })
})

describe('chapter lore', () => {
  it("lands on the chapter's last entry", () => {
    expect(bodyOf('latestChapterEndEntryId')).toContain('newest?.endEntryId')
    expect(bodyOf('chapterizeFromBeginning')).toContain('this.latestChapterEndEntryId()')
  })
})

describe('opening', () => {
  it('heads the opening narration while tracking is on', () => {
    const body = bodyOf('createStoryFromWizard')
    expect(body).toContain('settings.experimentalFeatures.stateTracking')
    expect(body).toContain('this.startHeader(')
  })
})

describe('imported chat', () => {
  it('drops the records of the story it replaces', () => {
    expect(bodyOf('importSTChat')).toContain('database.clearStoryEntries(')
    const database = readFileSync(
      fileURLToPath(new URL('../database.ts', import.meta.url)),
      'utf-8',
    )
    const clear = database.slice(database.indexOf('async clearStoryEntries('))
    expect(clear.slice(0, clear.indexOf('\n  }\n'))).toContain(
      'DELETE FROM world_state_changes WHERE story_id = ? AND branch_id IS NULL',
    )
  })

  it('starts tracking at its last entry', () => {
    const body = bodyOf('importSTChat')
    expect(body).toContain('settings.experimentalFeatures.stateTracking')
    expect(body).toContain('this.startHeader(')
  })

  it('is chapterized without breaking a run', () => {
    expect(bodyOf('chapterizeFromBeginning')).not.toContain('break')
  })
})

describe('closing snapshots', () => {
  it('snapshots only branches written to since tracking was turned on', () => {
    const body = bodyOf('takeClosingSnapshots')
    expect(body).toContain('database.getBranchesRecordedSince(since)')
    expect(body).toContain('settings.experimentalFeatures.trackingEnabledSince')
  })
})

describe('past checkpoints', () => {
  it('leaves incomplete snapshots out of the candidates, so the next full state is used', () => {
    expect(bodyOf('rebuildPastState')).toContain('.filter((s) => s.complete)')
  })

  it('reports the incomplete snapshots it skipped, up to the state used', () => {
    const body = bodyOf('previewCheckpointAt')
    expect(body).toContain('!s.complete')
    expect(body).toContain('s.entryPosition <= bound')
  })

  it('counts checkpoints on the whole branch line, the fork checkpoint included', () => {
    const body = bodyOf('rebuildPastState')
    expect(body).toContain('new Set(this.lineBranchIds())')
    expect(body).toContain('lineBranches.has(cp.branchId ?? null)')
  })

  it.each(['rebuildPastState', 'anchorState', 'createCheckpointAt'])(
    '%s leaves the story and its world state untouched',
    (method) => {
      const body = bodyOf(method)
      for (const write of [
        'this.commit(',
        'database.transaction(',
        'this.entries =',
        'this.characters =',
        'this.locations =',
        'this.items =',
        'this.storyBeats =',
        'this.lorebookEntries =',
      ]) {
        expect(body, `${method} must not contain ${write}`).not.toContain(write)
      }
    },
  )
})

describe('regenerate', () => {
  it('rewinds a retry through the records, as a delete does', () => {
    const body = bodyOf('rewindForRetry')
    expect(body).toContain('this.rollbackFrom(position, keep)')
    expect(body).toContain('this.deleteEntriesFromPosition(position, { skipRollback: true })')
  })

  it('drops the chapters on removed entries when restoring from a copy', () => {
    const body = bodyOf('restoreFromRetryBackup')
    expect(body).toContain('this.deleteEntriesFromPosition(backup.entryCountBeforeAction')
    expect(body).toContain('backup.lorebookEntries')
  })

  it('stops a regenerate whose revert fails while State Tracking is on', () => {
    expect(bodyOf('undoNarrationForRegenerate')).toContain(
      'if (settings.experimentalFeatures.stateTracking) throw error',
    )
  })

  it('previews a regenerate whatever Revert on Delete says', () => {
    const body = bodyOf('previewRegenerate')
    expect(body).toContain('settings.experimentalFeatures.stateTracking')
    expect(body).not.toContain('rollbackOnDelete')
  })
})
