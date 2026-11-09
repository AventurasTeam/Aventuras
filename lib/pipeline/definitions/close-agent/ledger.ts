import type { CloseReportCall } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { ID_PATTERN } from '@/lib/ids'
import { oneLine } from '@/lib/text'

import type { CloseIds } from './ids'
import type { CloseLedger } from '../intermediates'

/** C4: what a report keeps of one value. */
export const CLOSE_REPORT_VALUE_BOUND = 2_000

type NameOfId = (id: string) => string | undefined
type Survivor = NonNullable<CloseReportCall['survivor']>
type RowRef = { table: string; id: string }

function formatted(value: unknown, nameOfId: NameOfId): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return ID_PATTERN.test(value) ? (nameOfId(value) ?? value) : value
  if (Array.isArray(value)) return value.map((item) => formatted(item, nameOfId)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function bounded(text: string): string {
  if (text.length <= CLOSE_REPORT_VALUE_BOUND) return text
  return Array.from(text).slice(0, CLOSE_REPORT_VALUE_BOUND).join('')
}

/** C4: a list joins with ", ", a ref (a whole id) is its row's name, and every value is cut to the bound. */
export function reportValue(value: unknown, nameOfId: NameOfId): string {
  return bounded(formatted(value, nameOfId))
}

/** chapter-close.md → Review: the run-long ledger the report phase writes as `close_report` (C4). */
export class CloseLedgerWriter {
  constructor(
    private readonly ledger: CloseLedger,
    private readonly nameOfId: NameOfId,
    private readonly actionId: string,
  ) {}

  /** Any call the model made, an invalid one included, which records no row. */
  noteToolCall(): void {
    this.ledger.noToolCalls = false
  }

  record(
    call: Omit<CloseReportCall, 'values'> & { values?: Readonly<Record<string, unknown>> },
  ): void {
    const { values, ...rest } = call
    const shown = Object.entries(values ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([path, value]) => {
        const text = formatted(value, this.nameOfId)
        // C4's bound is set from a real run's largest value, so its length is read before the cut.
        logger.debug(
          'memory.close_report_value',
          { tool: rest.tool, path, length: Array.from(text).length },
          { actionId: this.actionId },
        )
        return [path, bounded(text)] as const
      })
    this.ledger.calls.push({
      ...rest,
      rows: rest.rows.map((row) => ({ ...row })),
      turns: [...rest.turns],
      ...(rest.skippedFields === undefined
        ? {}
        : { skippedFields: rest.skippedFields.map((skipped) => ({ ...skipped })) }),
      ...(rest.survivor === undefined ? {} : { survivor: { ...rest.survivor } }),
      ...(shown.length === 0 ? {} : { values: Object.fromEntries(shown) }),
    })
  }

  stop(entry: CloseLedger['stopped'][number]): void {
    this.ledger.stopped.push({ ...entry })
  }

  /** Where a row this close merged away went: the last kept row of a chain of landed merges. */
  survivorOf(table: string, id: string): Survivor | undefined {
    let found: Survivor | undefined
    let current: RowRef = { table, id }
    // Each landed merge absorbs a row for good, so a chain is never longer than the calls.
    for (let hop = 0; hop < this.ledger.calls.length; hop++) {
      const kept = this.keptRowOf(current)
      if (kept === undefined) break
      found = kept
      current = kept
    }
    return found
  }

  /** One line per landed call, for the next task's user half: tool, rows, landed fields, kept row. */
  writesSoFar(ids: CloseIds): string {
    const handle = (id: string): string => ids.handleOf(id) ?? ids.withHandles(id)
    return this.ledger.calls
      .flatMap((call) => {
        if (call.result !== 'ok') return []
        const skipped = new Set((call.skippedFields ?? []).map(({ field }) => field))
        const fields = Object.keys(call.values ?? {}).filter((field) => !skipped.has(field))
        if (fields.length === 0 && call.survivor === undefined) return []
        // A name goes into the next task's prompt: a line break would forge a line, a full id leak.
        const rows = call.rows
          .map(({ id, name }) => {
            const shown = ids.withHandles(oneLine(name))
            return shown === '' ? handle(id) : `${shown} (${handle(id)})`
          })
          .join(', ')
        const parts = [
          ...(fields.length === 0 ? [] : [fields.join(', ')]),
          ...(call.survivor === undefined ? [] : [`kept ${handle(call.survivor.id)}`]),
        ]
        return [`- ${call.tool} ${rows}: ${parts.join('; ')}`]
      })
      .join('\n')
  }

  private keptRowOf(row: RowRef): Survivor | undefined {
    return this.ledger.calls.find(
      (call) =>
        call.result === 'ok' &&
        call.survivor !== undefined &&
        call.survivor.table === row.table &&
        call.survivor.id !== row.id &&
        call.rows.some((named) => named.table === row.table && named.id === row.id),
    )?.survivor
  }
}
