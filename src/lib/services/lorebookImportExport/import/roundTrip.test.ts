import { describe, it, expect } from 'vitest'
import type { Entry } from '$lib/types'
import { exchangeToVaultLorebook, hasStorySideFields } from '$lib/services/exchange'
import { exportToAventura } from '../export/formats'
import { convertToEntries } from './convert'
import { parse } from './parse'

const source: Entry = {
  id: 'entry-1',
  storyId: 'story-1',
  name: 'Old Pell',
  type: 'character',
  description: 'Ferryman of the drowned coast.',
  hiddenInfo: 'He drowned the coast himself.',
  aliases: [],
  state: {
    type: 'character',
    isPresent: true,
    lastSeenLocation: 'entry-7',
    currentDisposition: 'wary',
    relationship: { level: 3, status: 'ally', history: [] },
    knownFacts: ['owns a boat'],
    revealedSecrets: ['the tide'],
  },
  adventureState: null,
  creativeState: null,
  injection: { mode: 'always', keywords: ['pell', 'ferry'], priority: 10 },
  createdBy: 'ai',
  createdAt: 1,
  updatedAt: 2,
  loreManagementBlacklisted: true,
  branchId: 'branch-1',
}

describe('lorebookImportExport / story round trip', () => {
  it('story -> export -> story keeps portable content and no source identifier or state', () => {
    const parsed = parse(exportToAventura([source], 'Story Lore'))
    expect(parsed.success).toBe(true)
    expect(parsed.metadata.format).toBe('aventura')
    expect(parsed.lorebook?.name).toBe('Story Lore')

    const [entry] = convertToEntries(parsed.entries)
    expect(entry.name).toBe(source.name)
    expect(entry.description).toBe(source.description)
    expect(entry.hiddenInfo).toBe(source.hiddenInfo)
    expect(entry.loreManagementBlacklisted).toBe(true)
    expect(entry.aliases).toEqual([])
    expect(entry.injection).toEqual(source.injection)
    expect(entry.createdBy).toBe('import')
    expect(entry.branchId).toBeNull()
    expect(entry.state).toEqual({
      type: 'character',
      isPresent: false,
      lastSeenLocation: null,
      currentDisposition: null,
      relationship: { level: 0, status: 'unknown', history: [] },
      knownFacts: [],
      revealedSecrets: [],
    })
    expect(JSON.stringify(entry)).not.toMatch(/entry-1|entry-7|story-1|branch-1/)
  })

  it('story -> export -> vault drops story-side fields and can say so', () => {
    const parsed = parse(exportToAventura([source], 'Story Lore'))
    expect(hasStorySideFields(parsed.entries)).toBe(true)
    const vault = exchangeToVaultLorebook(
      { ...parsed.lorebook!, entries: parsed.entries },
      { id: 'vault-1', originalFilename: 'story-lore.json' },
    )
    expect(vault.entries[0]).toEqual({
      name: 'Old Pell',
      type: 'character',
      description: 'Ferryman of the drowned coast.',
      keywords: ['pell', 'ferry'],
      aliases: [],
      injectionMode: 'always',
      priority: 10,
    })
  })
})
