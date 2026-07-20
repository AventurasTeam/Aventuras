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
  // An array and a plain object both report typeof 'object' and can share an
  // empty key set, so guard the mismatch before the key-wise comparison below.
  if (Array.isArray(a) || Array.isArray(b)) return false
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every((k) =>
      jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  }
  return false
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Add-only merge: fill object keys present in the parsed (schema-defaulted)
// shape but absent from storage; never overwrite a stored value or drop a
// stored key. Keeps a downgrade (older build, unknown newer key) from
// permanently pruning that key — the row is the only settings store until M7.
function addMissingDefaults(stored: unknown, parsed: unknown): unknown {
  // Recurse element-wise so array-typed columns (providers[], profiles[]) still
  // backfill schema-added fields; map over stored so no phantom default entries
  // are invented for a stored value that's shorter than the parsed default.
  if (Array.isArray(stored) && Array.isArray(parsed)) {
    return stored.map((item, i) => addMissingDefaults(item, parsed[i]))
  }
  if (!isPlainObject(stored) || !isPlainObject(parsed)) return stored
  const merged: Record<string, unknown> = { ...stored }
  for (const [key, parsedValue] of Object.entries(parsed)) {
    merged[key] = key in stored ? addMissingDefaults(stored[key], parsedValue) : parsedValue
  }
  return merged
}

/**
 * Boot-time row normalization: materialize schema-added default fields that are
 * absent from a stored app-settings column, so new fields live in the DB
 * instead of only as parse-time defaults — the row is the settings editing
 * surface until M7. Add-only: unknown keys and stored values are preserved, so
 * a downgrade never prunes a newer build's data. Columns that fail to parse are
 * left untouched (corrupt data stays inspectable); steady-state boots diff
 * clean and write nothing.
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
  // storySettingsPartialSchema) — its parsed shape materializes no defaults,
  // so add-only leaves it a natural noop.
  for (const [key, parsedValue] of Object.entries(config.data)) {
    const stored = (row as Record<string, unknown>)[key]
    const merged = addMissingDefaults(stored, parsedValue)
    if (!jsonEqual(merged, stored)) patch[key] = merged
  }
  const diag = appSettingsDiagnosticsSchema.safeParse(row.diagnostics)
  if (diag.success) {
    const merged = addMissingDefaults(row.diagnostics, diag.data)
    if (!jsonEqual(merged, row.diagnostics)) patch.diagnostics = merged
  }

  const columns = Object.keys(patch)
  if (columns.length === 0) return { status: 'noop' }

  await ctx.db.update(appSettings).set(patch).where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  return { status: 'normalized', columns }
}
