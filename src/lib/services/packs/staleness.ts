import type { PackTemplate } from './types'

/**
 * Has this template been left exactly as the app last wrote it?
 *
 * `baselineHash` moves only on a write from the code baseline, so content that still hashes
 * to it has never been through the template editor. Anything else is the user's work.
 *
 * The startup refresh needs this because it cannot otherwise tell "the app ships a newer
 * default" from "the user changed this": both show up as a stored hash that differs from the
 * current baseline. It used to compare against the stored content's own hash, so it read
 * every edit as a stale default and reverted it -- on every single app start.
 */
export function isUntouched(template: Pick<PackTemplate, 'contentHash' | 'baselineHash'>): boolean {
  return template.contentHash === template.baselineHash
}

/** Which of a pack's edited templates a refresh replaces. */
export type RefreshScope = 'behind' | 'edited'

/** Where a stored template sits relative to the text the app ships. */
export type TemplateState = 'current' | 'customised' | 'behind'

/** The rows of a pack that carry a user edit, split by whether newer text has shipped. */
export interface ClassifiedTemplates {
  behind: string[]
  customised: string[]
}

type Row = Pick<PackTemplate, 'templateId' | 'contentHash' | 'baselineHash'>

/**
 * Classify one row against the shipped text's hash.
 *
 * `baselineHash` is the hash of the shipped text this row was last written from, so it
 * separates "the user changed this" from "the app has changed it since". Both halves are
 * needed: `isUntouched` alone counts customisations as stale, and the baseline comparison
 * alone flags every row of a pack whose baseline was never the shipped text.
 *
 * `null` when the app no longer ships this id -- there is nothing to compare against and
 * nothing to bring the row forward to.
 *
 * A row the editor created carries `baselineHash: ''`, which matches no shipped hash and so
 * reads as behind. The listing names it before anything is written.
 */
export function classifyTemplate(row: Row, shippedHash: string | undefined): TemplateState | null {
  if (shippedHash === undefined) return null
  if (isUntouched(row)) return 'current'
  return row.baselineHash === shippedHash ? 'customised' : 'behind'
}

/** The same over a pack's rows, keeping only the edited ones. */
export function classifyTemplates(
  rows: Row[],
  shippedHashes: Map<string, string>,
): ClassifiedTemplates {
  const behind: string[] = []
  const customised: string[] = []

  for (const row of rows) {
    const state = classifyTemplate(row, shippedHashes.get(row.templateId))
    if (state === 'behind') behind.push(row.templateId)
    else if (state === 'customised') customised.push(row.templateId)
  }

  return { behind, customised }
}
