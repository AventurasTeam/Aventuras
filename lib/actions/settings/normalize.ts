import { eq } from 'drizzle-orm'

import {
  APP_SETTINGS_SINGLETON_ID,
  appSettings,
  appSettingsConfigSchema,
  appSettingsDiagnosticsSchema,
} from '@/lib/db'

import type { SettingsActionCtx } from './types'

export type NormalizeAppSettingsResult =
  | { status: 'normalized'; columns: string[] }
  | { status: 'noop' }
  | { status: 'skipped-corrupt' }
  | { status: 'no-row' }

// Key-order-insensitive; `undefined` object entries compare equal to absent
// ones (JSON can't store them, so the round-trip drops them anyway).
function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every((k) =>
      jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  }
  return false
}

/**
 * Boot-time row normalization: rewrite any app-settings column whose stored
 * JSON differs from its parsed (schema-defaulted, unknown-key-stripped) shape,
 * so schema-added fields materialize in the DB instead of living only as
 * parse-time defaults — the row is the settings editing surface until M7.
 * Columns that fail to parse are left untouched (corrupt data stays
 * inspectable); steady-state boots diff clean and write nothing.
 */
export async function normalizeAppSettingsRow(
  ctx: SettingsActionCtx,
): Promise<NormalizeAppSettingsResult> {
  const [row] = await ctx.db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  if (!row) return { status: 'no-row' }

  const config = appSettingsConfigSchema.safeParse(row)
  if (!config.success) return { status: 'skipped-corrupt' }

  const patch: Record<string, unknown> = {}
  // defaultStorySettings stays partial through the parse (see
  // storySettingsPartialSchema) — materializing defaults here would freeze
  // them as if user-chosen; the diff below must stay a natural noop for it.
  for (const [key, parsedValue] of Object.entries(config.data)) {
    if (!jsonEqual(parsedValue, (row as Record<string, unknown>)[key])) patch[key] = parsedValue
  }
  const diag = appSettingsDiagnosticsSchema.safeParse(row.diagnostics)
  if (diag.success && !jsonEqual(diag.data, row.diagnostics)) patch.diagnostics = diag.data

  const columns = Object.keys(patch)
  if (columns.length === 0) return { status: 'noop' }

  await ctx.db.update(appSettings).set(patch).where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  return { status: 'normalized', columns }
}
