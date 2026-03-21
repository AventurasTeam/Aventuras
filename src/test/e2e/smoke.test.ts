import { describe, it, expect } from 'vitest'

describe('E2E workspace', () => {
  it('can import real stores', async () => {
    const { story } = await import('$lib/stores/story/index.svelte')
    expect(story).toBeDefined()
    expect(story.currentStory).toBeNull()
  })
})
