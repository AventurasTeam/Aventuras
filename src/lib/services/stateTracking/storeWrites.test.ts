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
  return source.slice(start, start + 1 + next)
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
