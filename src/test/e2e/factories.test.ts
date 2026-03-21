import { describe, it, expect } from 'vitest'
import {
  buildStory,
  buildCharacter,
  buildLocation,
  buildEntry,
  buildLorebookEntry,
  buildChapter,
} from '$test/factories'

describe('story factories', () => {
  it('buildStory returns valid Story with defaults', () => {
    const s = buildStory()
    expect(s.id).toBeTruthy()
    expect(s.mode).toBe('adventure')
    expect(s.settings).toBeDefined()
  })

  it('buildStory accepts overrides', () => {
    const s = buildStory({ mode: 'creative-writing', genre: 'sci-fi' })
    expect(s.mode).toBe('creative-writing')
    expect(s.genre).toBe('sci-fi')
  })

  it('buildCharacter returns valid Character', () => {
    const c = buildCharacter({ name: 'Kael', relationship: 'self' })
    expect(c.name).toBe('Kael')
    expect(c.relationship).toBe('self')
    expect(c.id).toBeTruthy()
  })

  it('buildEntry returns valid StoryEntry', () => {
    const e = buildEntry({ type: 'user_action', content: 'I attack the dragon' })
    expect(e.type).toBe('user_action')
    expect(e.content).toBe('I attack the dragon')
  })

  it('buildLocation returns valid Location', () => {
    const l = buildLocation({ name: 'Dragon Cave' })
    expect(l.name).toBe('Dragon Cave')
  })

  it('buildLorebookEntry returns valid LorebookEntry', () => {
    const le = buildLorebookEntry({ name: 'Elder Dragon', keywords: ['dragon', 'elder'] })
    expect(le.name).toBe('Elder Dragon')
  })

  it('buildChapter returns valid Chapter', () => {
    const ch = buildChapter({ title: 'The Beginning' })
    expect(ch.title).toBe('The Beginning')
  })
})
