import { describe, expect, it } from 'vitest'

import { detectRichEntryHtml, parseMarkdownToHtml } from '@/lib/markdown'

import { buildSeedSteps } from './seed-dataset'

type Row = Record<string, unknown>

function rowsOf(name: string): Row[] {
  const step = buildSeedSteps().find((s) => s.name === name)
  expect(step, `step ${name}`).toBeDefined()
  return step!.rows as Row[]
}

describe('buildSeedSteps', () => {
  it('builds without throwing (every Zod parse in the dataset passes)', () => {
    expect(() => buildSeedSteps()).not.toThrow()
  })

  it('keeps foreign keys consistent across stories, branches, entries, chapters', () => {
    const storyIds = new Set(rowsOf('stories').map((r) => r.id))
    const branchRows = rowsOf('branches')
    const branchIds = new Set(branchRows.map((r) => r.id))
    const chapterIds = new Set(rowsOf('chapters').map((r) => r.id))

    for (const branch of branchRows) expect(storyIds).toContain(branch.storyId)
    for (const entry of rowsOf('story_entries')) {
      expect(branchIds).toContain(entry.branchId)
      if (entry.chapterId != null) expect(chapterIds).toContain(entry.chapterId)
    }
  })

  it('seeds the rich-rendering story with entries the detector actually flags', () => {
    const richEntries = rowsOf('story_entries').filter((r) => r.branchId === 'branch_rich_main')
    expect(richEntries.length).toBeGreaterThanOrEqual(40)

    const flagged = richEntries.filter((r) =>
      detectRichEntryHtml(parseMarkdownToHtml(r.content as string)),
    )
    expect(flagged.length).toBeGreaterThanOrEqual(15)
  })

  it('routes every security probe through the rich path (a plain-path probe tests nothing)', () => {
    const probes = rowsOf('story_entries').filter(
      (r) => r.branchId === 'branch_rich_main' && (r.content as string).startsWith('PROBE'),
    )
    expect(probes.length).toBeGreaterThanOrEqual(5)
    for (const probe of probes) {
      expect(
        detectRichEntryHtml(parseMarkdownToHtml(probe.content as string)),
        (probe.content as string).slice(0, 40),
      ).toBe(true)
    }
  })
})
