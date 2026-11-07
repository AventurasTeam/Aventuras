import { describe, expect, it } from 'vitest'

import {
  chapterActions,
  chapterDraftFrom,
  chapterDraftSchema,
  EMPTY_CHAPTER_DRAFT,
  isChapterIssue,
  type ChapterDraft,
  type ChapterDraftRow,
} from './chapter-draft'

const ROW: ChapterDraftRow = {
  id: 'chap_keep',
  title: 'The Keep Leans Closer',
  theme: 'dread',
  summary: 'The courier reaches the keep at dusk.',
  keywords: ['Keep'],
}

const actionsFor = (draft: ChapterDraft, row: ChapterDraftRow = ROW) =>
  chapterActions({ branchId: 'br_1', row, draft })

describe('chapterDraftSchema', () => {
  it('refuses a blank title and a blank summary, each with its own issue', () => {
    const result = chapterDraftSchema.safeParse({
      ...chapterDraftFrom(ROW),
      title: '  ',
      summary: ' \n ',
    })
    expect(result.success).toBe(false)
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message)
    expect(messages).toEqual(['titleRequired', 'summaryRequired'])
  })

  it('lets a blank theme through', () => {
    expect(chapterDraftSchema.safeParse({ ...chapterDraftFrom(ROW), theme: '   ' }).success).toBe(
      true,
    )
  })
})

describe('isChapterIssue', () => {
  it('knows its own issues and nothing else', () => {
    expect(isChapterIssue('titleRequired')).toBe(true)
    expect(isChapterIssue('summaryRequired')).toBe(true)
    expect(isChapterIssue('bodyRequired')).toBe(false)
  })
})

describe('chapterDraftFrom', () => {
  it('hands each blank draft a keyword list of its own', () => {
    chapterDraftFrom(null).keywords.push('Keep')
    expect(chapterDraftFrom(null)).toEqual({ title: '', theme: '', summary: '', keywords: [] })
    expect(EMPTY_CHAPTER_DRAFT.keywords).toEqual([])
  })

  it("copies a row's columns into a draft whose keyword list is its own", () => {
    const draft = chapterDraftFrom(ROW)
    expect(draft).toEqual({
      title: 'The Keep Leans Closer',
      theme: 'dread',
      summary: 'The courier reaches the keep at dusk.',
      keywords: ['Keep'],
    })
    expect(draft.keywords).not.toBe(ROW.keywords)
  })
})

describe('chapterActions', () => {
  it('writes nothing for an unchanged draft', () => {
    expect(actionsFor(chapterDraftFrom(ROW))).toEqual([])
  })

  it('writes nothing when the stored columns carry padding and repeats the draft normalizes away', () => {
    const padded: ChapterDraftRow = {
      ...ROW,
      title: '  The Keep Leans Closer ',
      theme: ' dread ',
      summary: 'The courier reaches the keep at dusk.\n',
      keywords: ['  Amulet ', 'amulet', 'Keep'],
    }
    expect(actionsFor(chapterDraftFrom(padded), padded)).toEqual([])
  })

  it('writes nothing when the draft only pads or repeats a stored keyword', () => {
    expect(actionsFor({ ...chapterDraftFrom(ROW), keywords: [' Keep ', 'keep', 'KEEP '] })).toEqual(
      [],
    )
  })

  it('saves padded, repeated keywords trimmed, with the first spelling kept', () => {
    expect(
      actionsFor({ ...chapterDraftFrom(ROW), keywords: ['  Amulet ', 'amulet', 'Keep'] }),
    ).toEqual([
      {
        kind: 'updateChapter',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'chap_keep', patch: { keywords: ['Amulet', 'Keep'] } },
      },
    ])
  })

  it('writes a re-cased keyword: its stored spelling changes though matching ignores case', () => {
    const [action] = actionsFor({ ...chapterDraftFrom(ROW), keywords: ['keep'] })
    expect(action).toMatchObject({ payload: { patch: { keywords: ['keep'] } } })
  })

  it('writes only the changed columns, trimmed, with a blank theme as an empty string', () => {
    expect(
      actionsFor({ ...chapterDraftFrom(ROW), title: '  The Keep Falls ', theme: '   ' }),
    ).toEqual([
      {
        kind: 'updateChapter',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          id: 'chap_keep',
          patch: { title: 'The Keep Falls', theme: '' },
        },
      },
    ])
  })

  it('writes a summary edit trimmed', () => {
    expect(actionsFor({ ...chapterDraftFrom(ROW), summary: ' The keep gives way. ' })).toEqual([
      {
        kind: 'updateChapter',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'chap_keep', patch: { summary: 'The keep gives way.' } },
      },
    ])
  })

  it('writes a removed keyword', () => {
    const row: ChapterDraftRow = { ...ROW, keywords: ['Keep', 'Amulet'] }
    expect(actionsFor({ ...chapterDraftFrom(row), keywords: ['Keep'] }, row)).toEqual([
      {
        kind: 'updateChapter',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'chap_keep', patch: { keywords: ['Keep'] } },
      },
    ])
  })

  it('writes a cleared keyword list', () => {
    const row: ChapterDraftRow = { ...ROW, keywords: ['Keep', 'Amulet'] }
    expect(actionsFor({ ...chapterDraftFrom(row), keywords: [] }, row)).toEqual([
      {
        kind: 'updateChapter',
        source: 'user_edit',
        payload: { branchId: 'br_1', id: 'chap_keep', patch: { keywords: [] } },
      },
    ])
  })
})
