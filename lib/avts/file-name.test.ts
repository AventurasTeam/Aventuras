import { describe, expect, it } from 'vitest'

import { avtsFileName } from './file-name'

describe('avtsFileName', () => {
  it.each([
    ['character', 'Kael', 'character-kael.avts'],
    ['character', 'Élodie', 'character-elodie.avts'],
    ['character', 'Zoë Vance', 'character-zoe-vance.avts'],
    ['character', 'Ｋａｅｌ', 'character-kael.avts'],
    ['lore', 'The Old  Road, North!', 'lore-the-old-road-north.avts'],
    ['location', 'Gate 7', 'location-gate-7.avts'],
    ['thread', '  --Find the Key--  ', 'thread-find-the-key.avts'],
    ['character', 'カエル', 'character.avts'],
    ['character', '', 'character.avts'],
    ['happening', '!!!', 'happening.avts'],
  ])('%s %j → %s', (prefix, name, expected) => {
    expect(avtsFileName(prefix, name)).toBe(expected)
  })

  it('caps the slug at 60 characters', () => {
    expect(avtsFileName('lore', 'a'.repeat(70))).toBe(`lore-${'a'.repeat(60)}.avts`)
  })

  it('drops a separator the cap leaves at the end', () => {
    expect(avtsFileName('lore', `${'a'.repeat(59)} bcd`)).toBe(`lore-${'a'.repeat(59)}.avts`)
  })
})
