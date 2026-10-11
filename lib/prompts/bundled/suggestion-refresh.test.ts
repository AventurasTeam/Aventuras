import { describe, expect, it } from 'vitest'

import { renderTemplate, TEMPLATE_IDS } from '../index'

type Definition = { setting: string; genre: string; tone: string }

const FULL: Definition = {
  setting: 'A keep on a hill.',
  genre: 'High fantasy.',
  tone: 'Dry humor.',
}

const render = ({ setting, genre, tone }: Definition) =>
  renderTemplate(TEMPLATE_IDS.suggestionRefresh, {
    definition: {
      mode: 'adventure',
      setting,
      genre: { promptBody: genre },
      tone: { promptBody: tone },
    },
    entities: [
      {
        id: 'char_1',
        kind: 'character',
        name: 'Aria',
        description: 'A wary scout.',
        status: 'active',
        injectionMode: 'auto',
      },
    ],
    sceneEntities: ['char_1'],
    entries: [{ content: 'The gate groaned open.' }],
    suggestionCount: 2,
    suggestionSlots: [{ ref: 'cat1', label: 'Action', promptHint: 'A decisive move.' }],
    refreshGuidance: 'Sneak around the back.',
  })

// architecture.md → System and user halves: the refresh's system half is Setting, Genre
// and Tone; the scene, the story, the options and the reader's draft are its user half.
describe('bundled suggestion-refresh template — system and user halves', () => {
  it('holds Setting, Genre and Tone in the system half, in that order, and nothing after them', () => {
    expect(render(FULL).system).toBe(
      '# Setting\nA keep on a hill.\n\n# Genre\nHigh fantasy.\n\n# Tone\nDry humor.',
    )
  })

  // Each block carries its own trailing blank line; whichever block is last, the half
  // must not end on it.
  it.each([
    {
      name: 'no genre',
      definition: { ...FULL, genre: '' },
      system: '# Setting\nA keep on a hill.\n\n# Tone\nDry humor.',
    },
    {
      name: 'no tone',
      definition: { ...FULL, tone: '' },
      system: '# Setting\nA keep on a hill.\n\n# Genre\nHigh fantasy.',
    },
    {
      name: 'genre only',
      definition: { setting: '', genre: 'High fantasy.', tone: '' },
      system: '# Genre\nHigh fantasy.',
    },
  ])('joins the blocks that are set with one blank line ($name)', ({ definition, system }) => {
    expect(render(definition).system).toBe(system)
  })

  it('renders a blank system half when the definition sets no setting, genre or tone', () => {
    const { system, user } = render({ setting: '', genre: '', tone: '' })
    expect(system).toBe('')
    expect(user).toContain('# Story so far')
  })

  it('carries the scene, the story, the options and the draft in the user half', () => {
    const { user } = render(FULL)
    expect(user.split('\n').filter((line) => line.startsWith('# '))).toEqual([
      '# In scene',
      '# Story so far',
      '# Next-turn options',
    ])
    expect(user).toContain(
      'The reader has already started writing their next turn:\n\nSneak around the back.',
    )
    for (const definitionText of [
      '# Setting',
      '# Genre',
      '# Tone',
      'A keep on a hill.',
      'High fantasy.',
      'Dry humor.',
    ]) {
      expect(user).not.toContain(definitionText)
    }
  })
})
