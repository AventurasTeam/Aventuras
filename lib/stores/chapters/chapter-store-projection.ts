import type { StorePatch } from '@/lib/actions'

/**
 * C4: the report stays out of chaptersStore, which keeps only whether a row has one. A patch
 * without `closeReport` leaves the flag: an update's as stored, a store-shaped create's its own.
 */
export function projectChapterPatch(p: StorePatch): StorePatch {
  switch (p.op) {
    case 'create': {
      const { closeReport, ...row } = p.row
      const hasCloseReport =
        'closeReport' in p.row ? closeReport != null : row.hasCloseReport === true
      return { op: 'create', id: p.id, row: { ...row, hasCloseReport } }
    }
    case 'update': {
      if (!('closeReport' in p.columns)) return p
      const { closeReport, ...columns } = p.columns
      return {
        op: 'update',
        id: p.id,
        columns: { ...columns, hasCloseReport: closeReport != null },
      }
    }
    case 'delete':
      return p
  }
}
