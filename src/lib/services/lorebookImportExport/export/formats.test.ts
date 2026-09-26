import { describe, it, expect } from 'vitest'
import type { Entry } from '$lib/types'
import { EXCHANGE_FORMAT, EXCHANGE_FORMAT_VERSION } from '$lib/services/exchange'
import { exportToAventura, exportToSillyTavern, exportToText } from './formats'

const entry: Entry = {
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
    currentDisposition: null,
    relationship: { level: 0, status: 'unknown', history: [] },
    knownFacts: [],
    revealedSecrets: [],
  },
  adventureState: null,
  creativeState: null,
  injection: { mode: 'keyword', keywords: ['pell'], priority: 40 },
  createdBy: 'user',
  createdAt: 1,
  updatedAt: 2,
  loreManagementBlacklisted: true,
  branchId: 'branch-1',
}

describe('lorebookImportExport / export formats', () => {
  it('writes the story lorebook as an exchange envelope with portable content only', () => {
    const text = exportToAventura([entry], 'Story Lore')
    const doc = JSON.parse(text)
    expect(doc.format).toBe(EXCHANGE_FORMAT)
    expect(doc.formatVersion).toBe(EXCHANGE_FORMAT_VERSION)
    expect(doc.entity).toBe('lorebook')
    expect(doc.data.name).toBe('Story Lore')
    expect(doc.data.entries).toEqual([
      {
        name: 'Old Pell',
        type: 'character',
        description: 'Ferryman of the drowned coast.',
        keywords: ['pell'],
        aliases: ['the ferryman'],
        injectionMode: 'keyword',
        priority: 40,
        hiddenInfo: 'He drowned the coast himself.',
        loreManagementBlacklisted: true,
      },
    ])
    for (const leaked of ['entry-1', 'entry-7', 'story-1', 'branch-1', 'isPresent', 'createdAt']) {
      expect(text).not.toContain(leaked)
    }
  })

  it('leaves the SillyTavern and text exports untouched', () => {
    const st = JSON.parse(exportToSillyTavern([entry], 'Story Lore'))
    expect(st.entries['0'].comment).toBe('Old Pell')
    expect(st.name).toBe('Story Lore')
    expect(exportToText([entry])).toContain('### Old Pell')
  })
})
