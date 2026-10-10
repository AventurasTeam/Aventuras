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

  it('records nothing while State Tracking is off', () => {
    expect(bodyOf('recordContext')).toContain('!settings.experimentalFeatures.stateTracking')
  })

  it('records the classifier as one batch with its header', () => {
    const body = bodyOf('applyClassificationResult')
    expect(body).toContain("this.recordContext({ origin: 'agent', entryId })")
    expect(body).toContain('diffStates(')
    expect(body).not.toContain('worldStateDelta')
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
