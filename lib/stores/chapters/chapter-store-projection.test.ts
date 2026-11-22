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

const NO_REPORT = { hasCloseReport: false, closeReportActionId: null }

describe('projectChapterPatch', () => {
  it('drops the report from a created row, keeping that it had one and the action that wrote it', () => {
    expect(
      projectChapterPatch({ op: 'create', id: 'chap_1', row: { ...ROW, closeReport: REPORT } }),
    ).toStrictEqual({
      op: 'create',
      id: 'chap_1',
      row: { ...ROW, hasCloseReport: true, closeReportActionId: 'act_close' },
    })
  })

  it('reads a create row with a null report, or none, as having none', () => {
    expect(
      projectChapterPatch({ op: 'create', id: 'chap_1', row: { ...ROW, closeReport: null } }),
    ).toStrictEqual({ op: 'create', id: 'chap_1', row: { ...ROW, ...NO_REPORT } })
    expect(projectChapterPatch({ op: 'create', id: 'chap_1', row: ROW })).toStrictEqual({
      op: 'create',
      id: 'chap_1',
      row: { ...ROW, ...NO_REPORT },
    })
  })

  // A row the store already shaped, as a test or a redo of a store row hands the patcher.
  it("keeps a store-shaped create's own flag and action", () => {
    const row = { ...ROW, hasCloseReport: true, closeReportActionId: 'act_rerun' }
    expect(projectChapterPatch({ op: 'create', id: 'chap_1', row })).toStrictEqual({
      op: 'create',
      id: 'chap_1',
      row,
    })
  })

  it("lets a create's report win over a store-shaped action it also carries", () => {
    expect(
      projectChapterPatch({
        op: 'create',
        id: 'chap_1',
        row: { ...ROW, closeReportActionId: 'act_stale', closeReport: REPORT },
      }),
    ).toStrictEqual({
      op: 'create',
      id: 'chap_1',
      row: { ...ROW, hasCloseReport: true, closeReportActionId: 'act_close' },
    })
  })

  it('turns an update writing a report into the flag and its action, keeping the other columns', () => {
    expect(
      projectChapterPatch({
        op: 'update',
        id: 'chap_1',
        columns: { closeReport: { ...REPORT, actionId: 'act_rerun' }, title: 'Black Dog' },
      }),
    ).toStrictEqual({
      op: 'update',
      id: 'chap_1',
      columns: { title: 'Black Dog', hasCloseReport: true, closeReportActionId: 'act_rerun' },
    })
  })

  // An undo of the report's write restores null.
  it('clears both on an update writing a null report', () => {
    expect(
      projectChapterPatch({ op: 'update', id: 'chap_1', columns: { closeReport: null } }),
    ).toStrictEqual({ op: 'update', id: 'chap_1', columns: NO_REPORT })
  })

  // A title save carries no closeReport key: deriving either here would clear a real report's.
  it('leaves both out of an update that does not write the report', () => {
    const patch = { op: 'update' as const, id: 'chap_1', columns: { title: 'Black Dog' } }
    const projected = projectChapterPatch(patch)
    expect(projected).toStrictEqual(patch)
    expect(projected.op === 'update' && 'hasCloseReport' in projected.columns).toBe(false)
    expect(projected.op === 'update' && 'closeReportActionId' in projected.columns).toBe(false)
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
