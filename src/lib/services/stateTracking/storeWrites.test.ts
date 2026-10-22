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

describe('a lore management session', () => {
  const body = () => bodyOf('saveLoreSession')

  it('records its writes', () => {
    expect(body()).toContain('this.recordContext(opts)')
  })

  it('plans the merges and deletes after the updates', () => {
    expect(body().indexOf('for (const entry of writes.updates)')).toBeLessThan(
      body().indexOf('for (const { sourceIds, merged } of writes.merges)'),
    )
  })

  it('commits once, and shows nothing unless that commit lands', () => {
    expect(body().match(/await this\.commit\(/g)).toHaveLength(1)
    expect(body()).not.toMatch(/await database\./)
    // And only on the lorebook still open, not the copy taken before the await.
    expect(body().indexOf('await this.commit(')).toBeLessThan(body().indexOf('this.isOpen('))
    expect(body().indexOf('this.isOpen(')).toBeLessThan(body().indexOf('this.lorebookEntries = ['))
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
  it('resolves through the pure module, from the whole branch line', () => {
    expect(bodyOf('rebuildPastState')).toContain('pastQuery(await this.pastSources()')
    const sources = bodyOf('pastSources')
    expect(sources).toContain('lineBranchIds: this.lineBranchIds()')
    expect(sources).toContain('complete: !!cp.lorebookEntriesSnapshot')
  })

  it.each(['rebuildPastState', 'anchorState', 'previewCheckpointAt', 'createCheckpointAt'])(
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

describe('deleting one entry', () => {
  it('moves the records to a neighbouring entry when no rollback is made', () => {
    expect(bodyOf('deleteEntry')).toContain(
      'recordsTo: recordsHolder(this.entries, existingEntry)?.id',
    )
  })
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
