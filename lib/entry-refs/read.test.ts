import { describe, expect, it, vi } from 'vitest'

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

async function seedEntry(content: string) {
  const { db } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  await db.insert(storyEntries).values({
    id: 'e_1',
    branchId: 'br_1',
    position: 1,
    kind: 'opening',
    content,
    chapterId: null,
    createdAt: 1,
  })
  return db
}

async function readExcerpt(content: string): Promise<string | undefined> {
  const [row] = await readEntryIndex('br_1', await seedEntry(content))
  return row?.excerpt
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
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    const excerpt = await readExcerpt(words)
    expect(excerpt?.endsWith('…')).toBe(true)
    expect(Array.from(excerpt ?? '').length).toBeLessThanOrEqual(121)
  })

  it('returns an empty excerpt for whitespace-only content', async () => {
    expect(await readExcerpt('   \n\t  \n  ')).toBe('')
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

    const rows = await readEntryIndex('br_1', db)
    expect(rows.map((r) => r.id)).toEqual(['e_2', 'e_1'])
    const index = indexEntryRefs(rows)
    expect(index.get('e_1')?.excerpt).toBe('Something in here pulses. It glows.')
    // The style block is all that follows, so the reader shows nothing more: no ellipsis owed.
    expect(index.get('e_2')?.excerpt).toBe('The room hums.')
  })

  it('reads past a leading style block longer than the first window', async () => {
    const style = `<style>.seed-resp { ${'padding: 10px; '.repeat(20)}}</style>\n\n`
    expect(style.length).toBeGreaterThan(300)
    expect(await readExcerpt(`${style}The lamps gutter out one by one.`)).toBe(
      'The lamps gutter out one by one.',
    )
  })

  it('reads past a mixed-case style, script and comment preamble to the prose', async () => {
    const preamble = [
      `<STYLE type="text/css">.a { ${'margin: 2px; '.repeat(150)}}</STYLE>`,
      '<script>window.x = "</div>"</script>',
      '<!-- layout -->',
    ].join('\n')
    expect(preamble.length).toBeGreaterThan(2000)
    const prose = 'The lamps gutter out one by one. '.repeat(6)
    expect(await readExcerpt(`${preamble}\n\n${prose}`)).toBe(
      'The lamps gutter out one by one. The lamps gutter out one by one. The lamps gutter out one by one. The lamps gutter out…',
    )
  })

  it('reads the rest of the wide window when markup after the preamble outlasts the near scan', async () => {
    const content = `<style>.a { color: red }</style>\n<div style="${'x'.repeat(900)}">The lamps gutter out.</div>`
    expect(await readExcerpt(content)).toBe('The lamps gutter out.')
  })

  it('shows nothing when a leading style block never closes inside the wide window', async () => {
    expect(await readExcerpt(`<style>.a { ${'margin: 2px; '.repeat(700)}`)).toBe('')
  })

  it('reads on when the first window cuts a tag open ahead of the prose', async () => {
    const content = `The door opens.\n<p style="${'color: red; '.repeat(20)}">A cold draft follows her in.</p>`
    expect(await readExcerpt(content)).toBe('The door opens. A cold draft follows her in.')
  })

  it('keeps a literal `<` in prose through the wider read', async () => {
    const content = `She typed <grin and walked off into the night. ${'The rain kept on. '.repeat(15)}`
    expect(await readExcerpt(content)).toBe(
      'She typed <grin and walked off into the night. The rain kept on. The rain kept on. The rain kept on. The rain kept on.…',
    )
  })

  it('reads once when the first window fills every preview', async () => {
    const db = await seedEntry('The rain has not stopped for three days. '.repeat(10))
    const select = vi.spyOn(db, 'select')
    await readEntryIndex('br_1', db)
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('keeps the last word whole when the wider window cuts right after a closing tag', async () => {
    // Exactly 8000 chars, so the next character (`<`) reads as a mid-word cut.
    const head = `<p style="${'x'.repeat(7970)}">The room hums.</p>`
    expect(head).toHaveLength(8000)
    expect(await readExcerpt(`${head}<p>More.</p>`)).toBe('The room hums.…')
  })

  it('adds an ellipsis for a truncated entry whose wider head collapses under the excerpt cap', async () => {
    // 7950 spaces + 26 letters + 10 spaces + 14-char tail: the 8000-char head collapses well
    // under the 120-char cap, so excerpt() alone wouldn't add '…' — the read must still add it.
    const content =
      ' '.repeat(7950) +
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
      ' '.repeat(10) +
      'MORE TEXT THAT WILL BE CUT OFF COMPLETELY BEYOND CHAR 8000 BOUNDARY AND NEVER APPEARS'
    expect(await readExcerpt(content)).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ MORE TEXT THAT…')
  })

  it('backs off to a whole word when the wider cut lands mid-word', async () => {
    // 7984 spaces + "quay again " + "unbel": the 8000-char cut lands 5 letters into
    // "unbelievable" — without the word-boundary back-off, the ellipsis would follow "…unbel…".
    const content =
      ' '.repeat(7984) +
      'quay again ' +
      'unbelievable stuff that continues well past the eight thousand character mark and further'
    expect(await readExcerpt(content)).toBe('quay again…')
  })

  // Unspaced scripts (Chinese, Japanese) have no word to back off to. Longer than the wider
  // window, so a head emptied by the back-off can't be rescued by the second read.
  const unspaced = '一二三四五六七八九十'
  it.each([
    ['no whitespace at all', unspaced.repeat(801)],
    ['only leading whitespace', `\n  ${unspaced.repeat(801)}`],
  ])('hard-cuts a mid-word head with %s instead of emptying it', async (_, content) => {
    expect(await readExcerpt(content)).toBe(`${unspaced.repeat(12)}…`)
  })
})
