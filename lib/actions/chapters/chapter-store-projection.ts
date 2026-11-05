import type { StorePatch } from '../delta/registry'

/**
 * Milestone C4: the report stays out of chaptersStore, which keeps only whether a row has one.
 * An update patch carries only what was written, so one without `closeReport` leaves the flag.
 */
export function projectChapterPatch(p: StorePatch): StorePatch {
  switch (p.op) {
    case 'create': {
      const { closeReport, ...row } = p.row
      return { op: 'create', id: p.id, row: { ...row, hasCloseReport: closeReport != null } }
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
