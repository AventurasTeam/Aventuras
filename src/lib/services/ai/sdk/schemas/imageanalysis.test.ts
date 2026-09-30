import { describe, expect, it } from 'vitest'
import { dropDuplicatePortraits, type ImageableScene } from './imageanalysis'

function scene(
  overrides: Partial<ImageableScene> & Pick<ImageableScene, 'prompt'>,
): ImageableScene {
  return {
    sourceText: 'quote',
    sceneType: 'character',
    priority: 5,
    characters: [],
    generatePortrait: false,
    ...overrides,
  }
}

describe('dropDuplicatePortraits', () => {
  it('keeps only the first portrait for a character, ignoring case', () => {
    const scenes = [
      scene({ prompt: 'a', characters: ['Mira'], generatePortrait: true }),
      scene({ prompt: 'b', characters: ['mira'], generatePortrait: true }),
    ]
    expect(dropDuplicatePortraits(scenes).map((s) => s.prompt)).toEqual(['a'])
  })

  it('keeps portraits for different characters', () => {
    const scenes = [
      scene({ prompt: 'a', characters: ['Mira'], generatePortrait: true }),
      scene({ prompt: 'b', characters: ['Tomas'], generatePortrait: true }),
    ]
    expect(dropDuplicatePortraits(scenes)).toHaveLength(2)
  })

  it('never drops non-portrait scenes, even for a character that has a portrait', () => {
    const scenes = [
      scene({ prompt: 'a', characters: ['Mira'], generatePortrait: true }),
      scene({ prompt: 'b', characters: ['Mira'] }),
      scene({ prompt: 'c', characters: ['Mira'] }),
    ]
    expect(dropDuplicatePortraits(scenes)).toHaveLength(3)
  })

  it('preserves order', () => {
    const scenes = [
      scene({ prompt: 'a', characters: ['Tomas'], generatePortrait: true }),
      scene({ prompt: 'b' }),
      scene({ prompt: 'c', characters: ['Mira'], generatePortrait: true }),
      scene({ prompt: 'd', characters: ['tomas'], generatePortrait: true }),
    ]
    expect(dropDuplicatePortraits(scenes).map((s) => s.prompt)).toEqual(['a', 'b', 'c'])
  })
})
