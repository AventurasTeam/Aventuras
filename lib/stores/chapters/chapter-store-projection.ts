import type { StorePatch } from '@/lib/actions'

/** C4: whether a row has a report, and the action of the close or re-run that wrote it. */
export type CloseReportFields =
  | { hasCloseReport: false; closeReportActionId: null }
  | { hasCloseReport: true; closeReportActionId: string }

const NO_REPORT: CloseReportFields = { hasCloseReport: false, closeReportActionId: null }

/**
 * C4's pair from a stored report's action. No writer stores a report without one, and the report
 * schema refuses it, so a report whose action isn't a string reads as none: no window could show it.
 */
export function closeReportFields(actionId: unknown): CloseReportFields {
  return typeof actionId === 'string'
    ? { hasCloseReport: true, closeReportActionId: actionId }
    : NO_REPORT
}

// The column's JSON reaches a patch unparsed.
function reportFields(report: unknown): CloseReportFields {
  return report == null ? NO_REPORT : closeReportFields((report as { actionId?: unknown }).actionId)
}

/**
 * C4: the report stays out of chaptersStore, which keeps only whether a row has one and its
 * action. A patch without `closeReport` leaves both: an update's as stored, a create's its own.
 */
export function projectChapterPatch(p: StorePatch): StorePatch {
  switch (p.op) {
    case 'create': {
      const { closeReport, ...row } = p.row
      const report =
        'closeReport' in p.row
          ? reportFields(closeReport)
          : row.hasCloseReport === true
            ? closeReportFields(row.closeReportActionId)
            : NO_REPORT
      return { op: 'create', id: p.id, row: { ...row, ...report } }
    }
    case 'update': {
      if (!('closeReport' in p.columns)) return p
      const { closeReport, ...columns } = p.columns
      return { op: 'update', id: p.id, columns: { ...columns, ...reportFields(closeReport) } }
    }
    case 'delete':
      return p
  }
}
