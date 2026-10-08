import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LorebookImportResult } from '../types'

vi.mock('$lib/services/database', () => ({
  database: { addEntry: vi.fn(async () => undefined) },
}))
vi.mock('../classify/classify', () => ({
  classifyEntries: vi.fn(async (entries: unknown[]) => entries),
}))

import { database } from '$lib/services/database'
import { classifyEntries } from '../classify/classify'
import { importEntries } from './orchestrator'

function result(format: 'aventura' | 'sillytavern'): LorebookImportResult {
  return {
    success: true,
    entries: [
      {
        name: 'Old Pell',
        type: 'character',
        description: 'Ferryman.',
        keywords: ['pell'],
        aliases: [],
        injectionMode: 'keyword',
        priority: 40,
        hiddenInfo: format === 'aventura' ? 'He drowned the coast.' : undefined,
        loreManagementBlacklisted: format === 'aventura' ? true : undefined,
      },
    ],
    errors: [],
    warnings: [],
    metadata: { format, totalEntries: 1, importedEntries: 1, skippedEntries: 1 },
  }
}

describe('lorebookImportExport / importEntries', () => {
  beforeEach(() => {
    vi.mocked(classifyEntries).mockClear()
    vi.mocked(database.addEntry).mockClear()
  })

  it('never classifies an Aventura export, even when asked to', async () => {
    const res = await importEntries(result('aventura'), {
      scope: { storyId: 'story-2', branchId: null },
      useAIClassification: true,
      storyMode: 'adventure',
    })
    expect(res.success).toBe(true)
    expect(classifyEntries).not.toHaveBeenCalled()
    const saved = vi.mocked(database.addEntry).mock.calls[0][0]
    expect(saved.storyId).toBe('story-2')
    expect(saved.hiddenInfo).toBe('He drowned the coast.')
    expect(saved.loreManagementBlacklisted).toBe(true)
    expect(saved.state.type).toBe('character')
  })

  it('classifies a SillyTavern lorebook when asked to', async () => {
    await importEntries(result('sillytavern'), {
      scope: { storyId: 'story-2', branchId: null },
      useAIClassification: true,
      storyMode: 'adventure',
    })
    expect(classifyEntries).toHaveBeenCalledTimes(1)
  })

  it('leaves a SillyTavern lorebook alone when not asked to', async () => {
    await importEntries(result('sillytavern'), {
      scope: { storyId: 'story-2', branchId: null },
      useAIClassification: false,
      storyMode: 'adventure',
    })
    expect(classifyEntries).not.toHaveBeenCalled()
    const saved = vi.mocked(database.addEntry).mock.calls[0][0]
    expect(saved.hiddenInfo).toBeNull()
    expect(saved.loreManagementBlacklisted).toBe(false)
  })

  it('writes each entry to the branch it was asked to', async () => {
    await importEntries(result('aventura'), {
      scope: { storyId: 'story-2', branchId: 'branch-1' },
      useAIClassification: false,
      storyMode: 'adventure',
    })
    const saved = vi.mocked(database.addEntry).mock.calls[0][0]
    expect(saved.storyId).toBe('story-2')
    expect(saved.branchId).toBe('branch-1')
  })

  it('returns the rows with the terms the database stores', async () => {
    const dup = result('aventura')
    dup.entries[0].keywords = ['pell', 'Pell ']
    const res = await importEntries(dup, {
      scope: { storyId: 'story-2', branchId: 'branch-1' },
      useAIClassification: false,
      storyMode: 'adventure',
    })
    expect(res.entries[0].injection.keywords).toEqual(['pell'])
    expect(vi.mocked(database.addEntry).mock.calls[0][0]).toBe(res.entries[0])
  })

  it('returns only the rows that were saved', async () => {
    const two = result('aventura')
    two.entries.push({ ...two.entries[0], name: 'Mara' })
    vi.mocked(database.addEntry).mockRejectedValueOnce(new Error('disk full'))
    const res = await importEntries(two, {
      scope: { storyId: 'story-2', branchId: 'branch-1' },
      useAIClassification: false,
      storyMode: 'adventure',
    })
    expect(res.entriesImported).toBe(1)
    expect(res.entries.map((e) => e.name)).toEqual(['Mara'])
    expect(res.entries[0].branchId).toBe('branch-1')
    expect(res.errors).toHaveLength(1)
  })
})
