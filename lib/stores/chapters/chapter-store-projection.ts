import type { StorePatch } from '@/lib/actions'

type ReportFields = { hasCloseReport: boolean; closeReportActionId: string | null }

// The column's JSON reaches a patch unparsed; a stored report always carries its action (C4).
function reportFields(report: unknown): ReportFields {
  if (report == null) return { hasCloseReport: false, closeReportActionId: null }
  const { actionId } = report as { actionId?: unknown }
  return {
    hasCloseReport: true,
    closeReportActionId: typeof actionId === 'string' ? actionId : null,
  }
}

/**
 * C4: the report stays out of chaptersStore, which keeps only whether a row has one and its
 * action. A patch without `closeReport` leaves both: an update's as stored, a create's its own.
 */
export function projectChapterPatch(p: StorePatch): StorePatch {
  switch (p.op) {
    case 'create': {
      const { closeReport, ...row } = p.row
      const report: ReportFields =
        'closeReport' in p.row
          ? reportFields(closeReport)
          : {
              hasCloseReport: row.hasCloseReport === true,
              closeReportActionId:
                typeof row.closeReportActionId === 'string' ? row.closeReportActionId : null,
            }
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
