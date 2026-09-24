import { describe, it, expect } from 'vitest'
import type { Entry, VaultCharacter, VaultLorebook, VaultScenario } from '$lib/types'
import {
  EXCHANGE_FORMAT,
  EXCHANGE_FORMAT_VERSION,
  characterToExchange,
  checkFormatVersion,
  exchangeToCharacter,
  exchangeToScenario,
  exchangeToVaultLorebook,
  hasStorySideFields,
  parseExchange,
  scenarioToExchange,
  serializeExchange,
  storyEntriesToExchange,
  vaultLorebookToExchange,
  wrapExchange,
} from './index'

const character: VaultCharacter = {
  id: 'char-1',
  name: 'Mira',
  description: 'A wandering cartographer.',
  traits: ['curious', 'stubborn'],
  visualDescriptors: { hair: 'silver braid', eyes: 'grey' },
  portrait: 'data:image/png;base64,AAAA',
  tags: ['npc', 'ally'],
  favorite: true,
  source: 'import',
  originalStoryId: 'story-1',
  createdAt: 1,
  updatedAt: 2,
  metadata: {
    cardVersion: 'v2',
    linkedLorebookId: 'lb-9',
    importing: true,
    sanitized: true,
    sourceUrl: 'https://example.invalid/mira.png',
  },
}

const scenario: VaultScenario = {
  id: 'scen-1',
  name: 'The Drowned Coast',
  description: 'Salt and secrets.',
  settingSeed: 'A coastline where the tide never returns.',
  npcs: [
    {
      name: 'Old Pell',
      role: 'guide',
      description: 'Ferryman',
      relationship: 'wary',
      traits: ['gruff'],
    },
  ],
  primaryCharacterName: 'Mira',
  firstMessage: 'The tide is out again.',
  alternateGreetings: ['Fog rolls in.'],
  startingTime: { years: 0, days: 2, hours: 6, minutes: 30 },
  tags: ['coastal'],
  favorite: false,
  source: 'wizard',
  originalFilename: 'coast.json',
  createdAt: 1,
  updatedAt: 2,
  metadata: { cardVersion: 'v2', npcCount: 99, linkedLorebookId: 'lb-9', importing: true },
}

const vaultLorebook: VaultLorebook = {
  id: 'lb-1',
  name: 'Coastal Lore',
  description: 'Everything about the coast.',
  entries: [
    {
      name: 'Old Pell',
      type: 'character',
      description: 'Ferryman of the drowned coast.',
      keywords: ['pell', 'ferry'],
      aliases: ['the ferryman'],
      injectionMode: 'keyword',
      priority: 40,
    },
  ],
  tags: ['coastal'],
  favorite: true,
  source: 'import',
  originalFilename: 'coast-lore.json',
  originalStoryId: null,
  createdAt: 1,
  updatedAt: 2,
  metadata: {
    format: 'sillytavern',
    totalEntries: 1,
    entryBreakdown: { character: 1, location: 0, item: 0, faction: 0, concept: 0, event: 0 },
    sourceUrl: 'https://example.invalid',
  },
}

const storyEntry: Entry = {
  id: 'entry-1',
  storyId: 'story-1',
  name: 'Old Pell',
  type: 'character',
  description: 'Ferryman of the drowned coast.',
  hiddenInfo: 'He drowned the coast himself.',
  aliases: ['the ferryman'],
  state: {
    type: 'character',
    isPresent: true,
    lastSeenLocation: 'entry-7',
    currentDisposition: 'wary',
    relationship: { level: 2, status: 'ally', history: [] },
    knownFacts: ['owns a boat'],
    revealedSecrets: [],
  },
  adventureState: null,
  creativeState: null,
  injection: { mode: 'always', keywords: ['pell'], priority: 10 },
  createdBy: 'user',
  createdAt: 1,
  updatedAt: 2,
  loreManagementBlacklisted: true,
  branchId: 'branch-1',
}

function textOf(entity: 'character' | 'lorebook' | 'scenario', data: unknown): string {
  return serializeExchange(wrapExchange(entity, data as never))
}

describe('exchange / envelope', () => {
  it('stamps the marker, entity and current version', () => {
    const doc = wrapExchange('character', characterToExchange(character))
    expect(doc.format).toBe(EXCHANGE_FORMAT)
    expect(doc.formatVersion).toBe(EXCHANGE_FORMAT_VERSION)
    expect(doc.entity).toBe('character')
    expect(doc.exportedAt).toBeGreaterThan(0)
  })

  it('treats anything without the marker as external', () => {
    expect(parseExchange('{"name":"Mira","description":"x"}', 'character').kind).toBe('external')
    expect(parseExchange('[{"name":"x","type":"item"}]', 'lorebook').kind).toBe('external')
    expect(parseExchange('not json', 'character').kind).toBe('external')
    expect(parseExchange('null', 'character').kind).toBe('external')
  })

  it('rejects a declared document with a malformed payload and never falls through', () => {
    const res = parseExchange(textOf('character', { description: 'no name' }), 'character')
    expect(res.kind).toBe('invalid')
    if (res.kind === 'invalid') expect(res.error).toMatch(/not valid at "name"/)
  })

  it('rejects the wrong entity for the destination', () => {
    const res = parseExchange(
      textOf('lorebook', vaultLorebookToExchange(vaultLorebook)),
      'character',
    )
    expect(res.kind).toBe('invalid')
    if (res.kind === 'invalid') expect(res.error).toMatch(/lorebook export, not a character/)
  })

  it('rejects an unknown entity', () => {
    const text = JSON.stringify({
      format: EXCHANGE_FORMAT,
      formatVersion: '1.0.0',
      entity: 'pet',
      data: {},
    })
    const res = parseExchange(text, 'character')
    expect(res.kind).toBe('invalid')
    if (res.kind === 'invalid') expect(res.error).toMatch(/Unknown Aventuras export type "pet"/)
  })

  it('rejects a document without a version', () => {
    const text = JSON.stringify({ format: EXCHANGE_FORMAT, entity: 'character', data: {} })
    expect(parseExchange(text, 'character').kind).toBe('invalid')
  })
})

describe('exchange / version', () => {
  it('accepts the current version silently', () => {
    expect(checkFormatVersion(EXCHANGE_FORMAT_VERSION)).toEqual({ ok: true, warning: null })
  })

  it('accepts a newer minor with a warning and ignores unknown fields', () => {
    const doc = wrapExchange('character', characterToExchange(character))
    const text = JSON.stringify({
      ...doc,
      formatVersion: '1.9.0',
      data: { ...doc.data, futureField: 'ignored' },
    })
    const res = parseExchange(text, 'character')
    expect(res.kind).toBe('exchange')
    if (res.kind !== 'exchange') return
    expect(res.warnings[0]).toMatch(/newer version/)
    expect('futureField' in res.document.data).toBe(false)
  })

  it('rejects a higher major with an actionable error', () => {
    const doc = wrapExchange('character', characterToExchange(character))
    const res = parseExchange(JSON.stringify({ ...doc, formatVersion: '2.0.0' }), 'character')
    expect(res.kind).toBe('invalid')
    if (res.kind === 'invalid') expect(res.error).toMatch(/Update Aventuras/)
  })

  it('rejects a version that is not semver', () => {
    expect(checkFormatVersion('1').ok).toBe(false)
  })
})

describe('exchange / character', () => {
  it('exports portable content only, filtering metadata by allowlist', () => {
    const data = characterToExchange(character)
    expect(data).toEqual({
      name: 'Mira',
      description: 'A wandering cartographer.',
      traits: ['curious', 'stubborn'],
      visualDescriptors: { hair: 'silver braid', eyes: 'grey' },
      portrait: 'data:image/png;base64,AAAA',
      tags: ['npc', 'ally'],
      favorite: true,
      metadata: { cardVersion: 'v2' },
    })
    const text = serializeExchange(wrapExchange('character', data))
    expect(text).not.toContain('char-1')
    expect(text).not.toContain('lb-9')
    expect(text).not.toContain('story-1')
    expect(text).not.toContain('importing')
  })

  it('round-trips with fresh identity and provenance', () => {
    const res = parseExchange(textOf('character', characterToExchange(character)), 'character')
    expect(res.kind).toBe('exchange')
    if (res.kind !== 'exchange') return
    const imported = exchangeToCharacter(res.document.data, {
      id: 'new-id',
      originalFilename: 'mira.json',
    })
    expect(imported.id).toBe('new-id')
    expect(imported.source).toBe('import')
    expect(imported.originalStoryId).toBeNull()
    expect(imported.createdAt).toBeGreaterThan(character.createdAt)
    expect(imported.metadata).toEqual({ cardVersion: 'v2', originalFilename: 'mira.json' })
    expect(imported.name).toBe(character.name)
    expect(imported.traits).toEqual(character.traits)
    expect(imported.visualDescriptors).toEqual(character.visualDescriptors)
    expect(imported.portrait).toBe(character.portrait)
    expect(imported.tags).toEqual(character.tags)
    expect(imported.favorite).toBe(true)
  })

  it('drops metadata keys outside the allowlist on import too', () => {
    const doc = wrapExchange('character', characterToExchange(character))
    const text = JSON.stringify({
      ...doc,
      data: { ...doc.data, metadata: { cardVersion: 'v2', linkedLorebookId: 'lb-9' } },
    })
    const res = parseExchange(text, 'character')
    if (res.kind !== 'exchange') throw new Error(res.kind)
    const imported = exchangeToCharacter(res.document.data, { id: 'x', originalFilename: 'f' })
    expect(imported.metadata).not.toHaveProperty('linkedLorebookId')
  })
})

describe('exchange / scenario', () => {
  it('exports portable content and recomputes derived metadata on import', () => {
    const data = scenarioToExchange(scenario)
    expect(data.metadata).toEqual({ cardVersion: 'v2' })
    const res = parseExchange(textOf('scenario', data), 'scenario')
    if (res.kind !== 'exchange') throw new Error(res.kind)
    const imported = exchangeToScenario(res.document.data, {
      id: 'new-id',
      originalFilename: 'coast.json',
    })
    expect(imported.id).toBe('new-id')
    expect(imported.settingSeed).toBe(scenario.settingSeed)
    expect(imported.npcs).toEqual(scenario.npcs)
    expect(imported.firstMessage).toBe(scenario.firstMessage)
    expect(imported.alternateGreetings).toEqual(scenario.alternateGreetings)
    expect(imported.startingTime).toEqual(scenario.startingTime)
    expect(imported.metadata).toEqual({
      cardVersion: 'v2',
      hasFirstMessage: true,
      alternateGreetingsCount: 1,
      npcCount: 1,
    })
  })
})

describe('exchange / scenario starting time', () => {
  it('normalizes an out-of-range starting time from a hand-edited file', () => {
    const data = {
      ...scenarioToExchange(scenario),
      startingTime: { years: 0, days: 0, hours: 25, minutes: 90 },
    }
    const res = parseExchange(textOf('scenario', data), 'scenario')
    if (res.kind !== 'exchange') throw new Error(res.kind)
    const imported = exchangeToScenario(res.document.data, { id: 'x', originalFilename: 'f' })
    expect(imported.startingTime).toEqual({ years: 0, days: 1, hours: 2, minutes: 30 })
  })

  it('rejects a negative starting time', () => {
    const data = {
      ...scenarioToExchange(scenario),
      startingTime: { years: 0, days: -1, hours: 0, minutes: 0 },
    }
    expect(parseExchange(textOf('scenario', data), 'scenario').kind).toBe('invalid')
  })

  it('carries an absent starting time as null', () => {
    const { startingTime: _omit, ...rest } = scenarioToExchange(scenario)
    const res = parseExchange(textOf('scenario', rest), 'scenario')
    if (res.kind !== 'exchange') throw new Error(res.kind)
    expect(res.document.data.startingTime).toBeNull()
  })
})

describe('exchange / lorebook', () => {
  it('exports the vault lorebook with its own fields and no derived metadata', () => {
    const data = vaultLorebookToExchange(vaultLorebook)
    expect(data.name).toBe('Coastal Lore')
    expect(data.description).toBe('Everything about the coast.')
    expect(data.tags).toEqual(['coastal'])
    expect(data.favorite).toBe(true)
    expect(data.metadata).toEqual({})
    expect(data.entries[0]).not.toHaveProperty('hiddenInfo')
  })

  it('round-trips a vault lorebook literally', () => {
    const res = parseExchange(
      textOf('lorebook', vaultLorebookToExchange(vaultLorebook)),
      'lorebook',
    )
    if (res.kind !== 'exchange') throw new Error(res.kind)
    const imported = exchangeToVaultLorebook(res.document.data, {
      id: 'new-id',
      originalFilename: 'coast-lore.json',
    })
    expect(imported.id).toBe('new-id')
    expect(imported.entries).toEqual(vaultLorebook.entries)
    expect(imported.name).toBe(vaultLorebook.name)
    expect(imported.favorite).toBe(true)
    expect(imported.metadata).toEqual({
      format: 'aventura',
      totalEntries: 1,
      entryBreakdown: { character: 1, location: 0, item: 0, faction: 0, concept: 0, event: 0 },
    })
  })

  it('exports story entries with story-side fields and without state or identifiers', () => {
    const data = storyEntriesToExchange([storyEntry], { name: 'Story Lore' })
    const text = serializeExchange(wrapExchange('lorebook', data))
    expect(data.entries[0]).toEqual({
      name: 'Old Pell',
      type: 'character',
      description: 'Ferryman of the drowned coast.',
      keywords: ['pell'],
      aliases: ['the ferryman'],
      injectionMode: 'always',
      priority: 10,
      hiddenInfo: 'He drowned the coast himself.',
      loreManagementBlacklisted: true,
    })
    expect(text).not.toContain('entry-1')
    expect(text).not.toContain('entry-7')
    expect(text).not.toContain('story-1')
    expect(text).not.toContain('branch-1')
    expect(text).not.toContain('isPresent')
    expect(hasStorySideFields(data.entries)).toBe(true)
  })

  it('drops story-side fields when imported into the vault', () => {
    const data = storyEntriesToExchange([storyEntry], { name: 'Story Lore' })
    const res = parseExchange(textOf('lorebook', data), 'lorebook')
    if (res.kind !== 'exchange') throw new Error(res.kind)
    expect(res.document.data.entries[0].hiddenInfo).toBe('He drowned the coast himself.')
    const imported = exchangeToVaultLorebook(res.document.data, { id: 'x', originalFilename: 'f' })
    expect(imported.entries[0]).not.toHaveProperty('hiddenInfo')
    expect(imported.entries[0]).not.toHaveProperty('loreManagementBlacklisted')
  })

  it('accepts an empty lorebook', () => {
    const res = parseExchange(
      textOf('lorebook', {
        name: 'Empty',
        description: null,
        tags: [],
        favorite: false,
        metadata: {},
        entries: [],
      }),
      'lorebook',
    )
    expect(res.kind).toBe('exchange')
  })
})
