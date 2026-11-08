import { describe, expect, it } from 'vitest'

import type { CloseReport } from '@/lib/db'

import { projectChapterPatch } from './chapter-store-projection'

const REPORT: CloseReport = {
  version: 1,
  actionId: 'act_close',
  calls: [],
  stopped: [],
  noToolCalls: true,
}

const ROW = {
  id: 'chap_1',
  branchId: 'br_1',
  sequenceNumber: 1,
  title: 'The Old Sea-dog',
  summary: 'A captain takes a room at the Admiral Benbow.',
  theme: 'arrival',
  keywords: ['inn', 'captain'],
  startEntryId: 'se_1',
  endEntryId: 'se_40',
  tokenCount: 24_000,
  closedAt: 100,
  embeddingStale: 1,
  createdAt: 100,
  updatedAt: 100,
}

describe('projectChapterPatch', () => {
  it('drops the report from a created row, flagging that it had one', () => {
    expect(
      projectChapterPatch({ op: 'create', id: 'chap_1', row: { ...ROW, closeReport: REPORT } }),
    ).toStrictEqual({ op: 'create', id: 'chap_1', row: { ...ROW, hasCloseReport: true } })
  })

  it('flags a create row with a null report, or none, as having none', () => {
    expect(
      projectChapterPatch({ op: 'create', id: 'chap_1', row: { ...ROW, closeReport: null } }),
    ).toStrictEqual({ op: 'create', id: 'chap_1', row: { ...ROW, hasCloseReport: false } })
    expect(projectChapterPatch({ op: 'create', id: 'chap_1', row: ROW })).toStrictEqual({
      op: 'create',
      id: 'chap_1',
      row: { ...ROW, hasCloseReport: false },
    })
  })

  it('turns an update writing a report into the flag, keeping the other columns', () => {
    expect(
      projectChapterPatch({
        op: 'update',
        id: 'chap_1',
        columns: { closeReport: REPORT, title: 'Black Dog' },
      }),
    ).toStrictEqual({
      op: 'update',
      id: 'chap_1',
      columns: { title: 'Black Dog', hasCloseReport: true },
    })
  })

  // An undo of the report's write restores null.
  it('clears the flag on an update writing a null report', () => {
    expect(
      projectChapterPatch({ op: 'update', id: 'chap_1', columns: { closeReport: null } }),
    ).toStrictEqual({ op: 'update', id: 'chap_1', columns: { hasCloseReport: false } })
  })

  // A title save carries no closeReport key: deriving the flag here would clear a real report's.
  it('leaves the flag out of an update that does not write the report', () => {
    const patch = { op: 'update' as const, id: 'chap_1', columns: { title: 'Black Dog' } }
    const projected = projectChapterPatch(patch)
    expect(projected).toStrictEqual(patch)
    expect(projected.op === 'update' && 'hasCloseReport' in projected.columns).toBe(false)
  })

  it('passes a delete through', () => {
    expect(projectChapterPatch({ op: 'delete', id: 'chap_1' })).toStrictEqual({
      op: 'delete',
      id: 'chap_1',
    })
  })

  // Redo hands the patcher its snapshot's row object, and reverse-replay its working copy.
  it('leaves the patch it was given unchanged', () => {
    const row = { ...ROW, closeReport: REPORT }
    projectChapterPatch({ op: 'create', id: 'chap_1', row })
    expect(row.closeReport).toBe(REPORT)
    const columns = { closeReport: REPORT }
    projectChapterPatch({ op: 'update', id: 'chap_1', columns })
    expect(columns).toStrictEqual({ closeReport: REPORT })
  })
})
