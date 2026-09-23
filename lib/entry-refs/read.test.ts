import { describe, expect, it } from 'vitest'

import { branches, storyEntries, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { indexEntryRefs, readEntryIndex } from './read'

async function setup() {
  const { db } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values([
    { id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 },
    { id: 'br_2', storyId: 'story_1', name: 'fork', createdAt: 1 },
  ])
  await db.insert(storyEntries).values([
    {
      id: 'e_1',
      branchId: 'br_1',
      position: 1,
      kind: 'opening',
      content: 'You arrive.',
      chapterId: 'chap_1',
      createdAt: 1,
    },
    {
      id: 'e_2',
      branchId: 'br_1',
      position: 2,
      kind: 'user_action',
      content:
        '  I draw   the blade and listen for footsteps in the long dark of the keep beneath the river.  ',
      chapterId: null,
      createdAt: 2,
    },
    {
      id: 'e_sys',
      branchId: 'br_1',
      position: 3,
      kind: 'system',
      content: 'Diagnostic note.',
      chapterId: null,
      createdAt: 3,
    },
    {
      id: 'e_x',
      branchId: 'br_2',
      position: 1,
      kind: 'opening',
      content: 'Other branch.',
      chapterId: null,
      createdAt: 1,
    },
  ])
  return db
}

describe('readEntryIndex', () => {
  it('lists the branch newest first with a collapsed excerpt and the chapter id', async () => {
    const db = await setup()
    const rows = await readEntryIndex('br_1', db)
    expect(rows.map((r) => r.id)).toEqual(['e_2', 'e_1'])
    expect(rows[0]).toMatchObject({ position: 2, kind: 'user_action', chapterId: null })
    expect(rows[0].excerpt.startsWith('I draw the blade')).toBe(true)
    expect(rows[1]).toMatchObject({ position: 1, chapterId: 'chap_1', excerpt: 'You arrive.' })
  })

  it('indexes by id', async () => {
    const db = await setup()
    const index = indexEntryRefs(await readEntryIndex('br_1', db))
    expect(index.get('e_1')?.position).toBe(1)
    expect(index.has('e_x')).toBe(false)
  })

  it('excludes system entries — nothing may anchor to a diagnostic row', async () => {
    const db = await setup()
    const rows = await readEntryIndex('br_1', db)
    expect(rows.some((r) => r.id === 'e_sys')).toBe(false)
    expect(rows.some((r) => r.kind === 'system')).toBe(false)
  })

  it('truncates long content at the excerpt cap with a trailing ellipsis', async () => {
    const { db } = await createTestDb()
    await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    await db.insert(storyEntries).values({
      id: 'e_long',
      branchId: 'br_1',
      position: 1,
      kind: 'opening',
      content: words,
      chapterId: null,
      createdAt: 1,
    })

    const [row] = await readEntryIndex('br_1', db)
    expect(row?.excerpt.endsWith('…')).toBe(true)
    expect(Array.from(row?.excerpt ?? '').length).toBeLessThanOrEqual(121)
  })

  it('returns an empty excerpt for whitespace-only content', async () => {
    const { db } = await createTestDb()
    await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
    await db.insert(storyEntries).values({
      id: 'e_blank',
      branchId: 'br_1',
      position: 1,
      kind: 'opening',
      content: '   \n\t  \n  ',
      chapterId: null,
      createdAt: 1,
    })

    const [row] = await readEntryIndex('br_1', db)
    expect(row?.excerpt).toBe('')
  })

  it('previews the prose of a rich entry, not its markup, even when the window cuts a tag', async () => {
    const { db } = await createTestDb()
    await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
    const glow =
      'Something in here pulses.\n\n<style>@keyframes seed-pulse { 50% { opacity: 0.35 } }</style>' +
      '<p class="seed-glow">**It glows.**</p>'
    const cutStyle = `The room hums.\n<style>.seed-resp { ${'padding: 10px; '.repeat(20)}}</style>`
    await db.insert(storyEntries).values([
      { id: 'e_1', branchId: 'br_1', position: 1, kind: 'ai_reply', content: glow, createdAt: 1 },
      {
        id: 'e_2',
        branchId: 'br_1',
        position: 2,
        kind: 'ai_reply',
        content: cutStyle,
        createdAt: 1,
      },
    ])

    const index = indexEntryRefs(await readEntryIndex('br_1', db))
    expect(index.get('e_1')?.excerpt).toBe('Something in here pulses. It glows.')
    expect(index.get('e_2')?.excerpt).toBe('The room hums.…')
  })

  it('keeps the last word whole when the window cuts right after a closing tag', async () => {
    const { db } = await createTestDb()
    await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
    // Exactly 200 chars, so the next character (`<`) reads as a mid-word cut.
    const head = `<p style="${'x'.repeat(170)}">The room hums.</p>`
    expect(head).toHaveLength(200)
    await db.insert(storyEntries).values({
      id: 'e_1',
      branchId: 'br_1',
      position: 1,
      kind: 'ai_reply',
      content: `${head}<p>More.</p>`,
      createdAt: 1,
    })

    const index = indexEntryRefs(await readEntryIndex('br_1', db))
    expect(index.get('e_1')?.excerpt).toBe('The room hums.…')
  })

  it('adds an ellipsis for a truncated entry whose 200-char head collapses under the excerpt cap', async () => {
    const { db } = await createTestDb()
    await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
    // 150 spaces + 26 letters + 10 spaces + 14-char tail: the 200-char head collapses well
    // under the 120-char cap, so excerpt() alone wouldn't add '…' — the read must still add it.
    const content =
      ' '.repeat(150) +
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
      ' '.repeat(10) +
      'MORE TEXT THAT WILL BE CUT OFF COMPLETELY BEYOND CHAR 200 BOUNDARY AND NEVER APPEARS'
    await db.insert(storyEntries).values({
      id: 'e_edge',
      branchId: 'br_1',
      position: 1,
      kind: 'opening',
      content,
      chapterId: null,
      createdAt: 1,
    })

    const [row] = await readEntryIndex('br_1', db)
    expect(row?.excerpt).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ MORE TEXT THAT…')
  })

  it('backs off to a whole word when the 200-char cut lands mid-word', async () => {
    const { db } = await createTestDb()
    await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
    // 184 spaces + "quay again " + "unbel": the 200-char cut lands 5 letters into
    // "unbelievable" — without the word-boundary back-off, the ellipsis would follow "…unbel…".
    const content =
      ' '.repeat(184) +
      'quay again ' +
      'unbelievable stuff that continues well past the two hundred character mark and further'
    await db.insert(storyEntries).values({
      id: 'e_midword',
      branchId: 'br_1',
      position: 1,
      kind: 'opening',
      content,
      chapterId: null,
      createdAt: 1,
    })

    const [row] = await readEntryIndex('br_1', db)
    expect(row?.excerpt).toBe('quay again…')
  })

  // Unspaced scripts (Chinese, Japanese) have no word to back off to.
  const unspaced = '一二三四五六七八九十'
  it.each([
    ['no whitespace at all', unspaced.repeat(25)],
    ['only leading whitespace', `\n  ${unspaced.repeat(25)}`],
  ])('hard-cuts a mid-word head with %s instead of emptying it', async (_, content) => {
    const { db } = await createTestDb()
    await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
    await db.insert(storyEntries).values({
      id: 'e_unspaced',
      branchId: 'br_1',
      position: 1,
      kind: 'opening',
      content,
      chapterId: null,
      createdAt: 1,
    })

    const [row] = await readEntryIndex('br_1', db)
    expect(row?.excerpt).toBe(`${unspaced.repeat(12)}…`)
  })
})
