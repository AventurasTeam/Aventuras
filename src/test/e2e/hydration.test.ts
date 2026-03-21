import { describe, it, expect, afterEach } from 'vitest'
import { story } from '$lib/stores/story/index.svelte'
import { loadTestStory, clearTestStory } from './utils/storeHydration'
import { buildStory, buildCharacter, buildEntry } from '$test/factories'

describe('store hydration', () => {
  afterEach(() => clearTestStory())

  it('loadTestStory populates story.currentStory', () => {
    const s = buildStory({ title: 'Test Adventure' })
    loadTestStory({ story: s })
    expect(story.currentStory?.title).toBe('Test Adventure')
  })

  it('loadTestStory populates characters', () => {
    const s = buildStory()
    const chars = [buildCharacter({ name: 'Kael', relationship: 'self' })]
    loadTestStory({ story: s, characters: chars })
    expect(story.character.characters).toHaveLength(1)
    expect(story.character.characters[0].name).toBe('Kael')
  })

  it('loadTestStory populates entries', () => {
    const s = buildStory()
    const entries = [
      buildEntry({ type: 'user_action', content: 'I look around' }),
      buildEntry({ type: 'narration', content: 'You see a cave.' }),
    ]
    loadTestStory({ story: s, entries })
    expect(story.entry.entries).toHaveLength(2)
  })

  it('clearTestStory resets all state', () => {
    loadTestStory({
      story: buildStory(),
      characters: [buildCharacter()],
    })
    clearTestStory()
    expect(story.currentStory).toBeNull()
    expect(story.character.characters).toHaveLength(0)
  })
})
