/**
 * Deciding which local pack an imported story binds to.
 *
 * The decision is a callback on `RunImportOptions` rather than a phase around the import, because
 * the two callers need opposite things from it: a file import can put a dialog in front of the
 * user, while sync must never block a transfer on a question. Same seam, different policy.
 *
 * Whatever answers, it answers *before* the story row is written — a story that exists bound to
 * the wrong pack is generatable in that state, and patching it afterwards would be a second write
 * outside the rollback window.
 */

import { database } from '$lib/services/database'
import { DEFAULT_PACK_ID, matchPack } from '$lib/services/packs/binding'
import type { PackMatch } from '$lib/services/packs/binding'
import type { PresetPack } from '$lib/services/packs/types'
import type { PackBindingExport, PackRuntimeVariableExport, PackVariableExport } from './types'

/** What a resolver is told about the file it is being asked to bind. */
export interface PackBindingContext {
  /** The file's pack section, already sanitized. Undefined for a file that records no pack. */
  binding: SanitizedPackBinding | null
  /** The auto-match against the local packs, for a resolver that wants to pre-select it. */
  match: PackMatch
}

/** What a resolver decides. */
export interface PackBindingResolution {
  packId: string
  customVariableValues?: Record<string, string>
}

/** A `packBinding` section with every field checked, so downstream code can trust its shape. */
export interface SanitizedPackBinding {
  pack: { name: string; author: string | null }
  customVariableValues?: Record<string, string>
  variables: PackVariableExport[]
  runtimeVariables: PackRuntimeVariableExport[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read a file's `packBinding`, tolerating anything.
 *
 * `validateExport` deliberately lets a malformed binding through: the field decides which
 * templates narrate the story, and rejecting the file over it would cost the user the story
 * itself. So a binding that does not parse degrades here to "records no pack" and takes the
 * legacy path.
 */
export function sanitizePackBinding(
  raw: PackBindingExport | undefined,
): SanitizedPackBinding | null {
  if (!isRecord(raw)) return null
  const pack = raw.pack
  if (!isRecord(pack) || typeof pack.name !== 'string' || !pack.name.trim()) return null

  const values = isRecord(raw.customVariableValues)
    ? (Object.fromEntries(
        Object.entries(raw.customVariableValues).filter(([, v]) => typeof v === 'string'),
      ) as Record<string, string>)
    : undefined

  return {
    pack: { name: pack.name, author: typeof pack.author === 'string' ? pack.author : null },
    ...(values && Object.keys(values).length > 0 ? { customVariableValues: values } : {}),
    variables: Array.isArray(raw.variables) ? raw.variables.filter(isRecord) : [],
    runtimeVariables: Array.isArray(raw.runtimeVariables)
      ? raw.runtimeVariables.filter(
          (v): v is PackRuntimeVariableExport =>
            isRecord(v) && typeof v.variableName === 'string' && typeof v.entityType === 'string',
        )
      : [],
  }
}

/** Build the context a resolver is handed, matching the file's pack against the local ones. */
export async function buildBindingContext(
  raw: PackBindingExport | undefined,
): Promise<PackBindingContext> {
  const binding = sanitizePackBinding(raw)
  const match = await matchPack(binding?.pack ?? null)
  return { binding, match }
}

/** The subset of a pack variable definition the prompt decision needs. */
export interface RequiredVariableDef {
  variableName: string
  isRequired: boolean
  defaultValue?: string
}

/** Variable names cross devices as user-authored strings, so compare them consistently. */
function normalizeVariableName(value: string): string {
  return value.trim().toLowerCase()
}

/** Find a story value by the same case-insensitive, trimmed name used for pack matching. */
export function customVariableValue(
  values: Record<string, string> | undefined,
  variableName: string,
): string | undefined {
  if (!values) return undefined
  if (Object.prototype.hasOwnProperty.call(values, variableName)) return values[variableName]

  const wanted = normalizeVariableName(variableName)
  return Object.entries(values).find(([name]) => normalizeVariableName(name) === wanted)?.[1]
}

/**
 * Add values under the selected pack's canonical spelling while retaining the source spelling.
 * Keeping both makes a later re-bind reversible, just like runtime-variable re-keying.
 */
export function canonicalizeCustomVariableValues(
  values: Record<string, string> | undefined,
  variables: Array<{ variableName: string }>,
): Record<string, string> {
  const canonical = { ...(values ?? {}) }
  for (const variable of variables) {
    if (Object.prototype.hasOwnProperty.call(canonical, variable.variableName)) continue
    const value = customVariableValue(values, variable.variableName)
    if (value !== undefined) canonical[variable.variableName] = value
  }
  return canonical
}

/** Persist imported answers plus fields the user actually edited, never untouched pack defaults. */
export function mergeCustomVariableValues(
  fileValues: Record<string, string> | undefined,
  variables: Array<{ variableName: string }>,
  editedValues: Record<string, string>,
): Record<string, string> {
  return { ...canonicalizeCustomVariableValues(fileValues, variables), ...editedValues }
}

/**
 * Required variables of the target pack that the story has no answer for.
 *
 * A pack-supplied default counts as an answer: the variable has a usable value without anyone
 * being asked, and interrupting an import to retype a default is the kind of prompt this design
 * exists to remove. Only a required variable with neither a story answer nor a default is a
 * genuine hole.
 *
 * This is reachable on an otherwise-confident match because packs are not versioned — the
 * recipient's copy of "the same" pack can define a required variable the sender's did not.
 */
export function unansweredRequiredVariables(
  variables: RequiredVariableDef[],
  values: Record<string, string> | undefined,
): string[] {
  return variables
    .filter((v) => v.isRequired)
    .filter((v) => !customVariableValue(values, v.variableName)?.trim() && !v.defaultValue?.trim())
    .map((v) => v.variableName)
}

/**
 * What, if anything, an interactive import needs to ask about this file.
 *
 * - `none` — bind and get on with it.
 * - `choose-pack` — which pack, because the match is uncertain or absent.
 * - `fill-values` — the pack is settled; only these required values are missing.
 */
export type PackPromptDecision =
  { prompt: 'none' } | { prompt: 'choose-pack' } | { prompt: 'fill-values'; missing: string[] }

/**
 * Decide what an interactive import asks the user about this file.
 *
 * A name+author match binds without a word. Every file written from 1.9.0 on records a pack (the
 * wizard always sets `pack_id`), so a confirm-on-match rule would put a modal in front of every
 * import forever — including re-importing one's own export, where no other answer exists. A
 * prompt whose only sensible answer is "yes" teaches people to dismiss prompts.
 *
 * Anything less than a confident match *is* a question: a name-only hit means one candidate, not
 * the right one, and no hit means the pack the story wants is not here — worth saying even when
 * the user has a single pack to accept, because the useful response may be to cancel and go
 * install it. A legacy file, having named nothing, has no such information to convey, which is
 * why the pack-count gate applies there and not here.
 *
 * A pure decision rather than a branch inside `runImport`: the pipeline keeps one rule ("ask the
 * resolver"), and the UI decides what it has to ask. Sync never calls this at all.
 */
export function decidePackPrompt(
  ctx: PackBindingContext,
  device: {
    legacyImportPackMapping: boolean
    packCount: number
    /** The matched pack's variables. Only consulted on a confident match. */
    matchedPackVariables?: RequiredVariableDef[]
  },
): PackPromptDecision {
  // A file that records no pack: today's silent path, unless the Labs opt-in is on and the
  // device has a choice worth offering.
  if (!ctx.binding) {
    return device.legacyImportPackMapping && device.packCount > 1
      ? { prompt: 'choose-pack' }
      : { prompt: 'none' }
  }

  if (ctx.match.confidence !== 'exact' || !ctx.match.pack) return { prompt: 'choose-pack' }

  const missing = unansweredRequiredVariables(
    device.matchedPackVariables ?? [],
    ctx.binding.customVariableValues,
  )
  return missing.length > 0 ? { prompt: 'fill-values', missing } : { prompt: 'none' }
}

/**
 * Everything a caller needs to act on, with none of the deciding left to do.
 *
 * `ask: false` carries the answer outright; `ask: true` carries what the dialog should be
 * configured with. The split exists because the two hosts differ only in *how* they show a
 * dialog — each owns its own component state — and not at all in when or what to show.
 */
export type PackPromptPlan =
  | { ask: false; resolution: PackBindingResolution }
  | { ask: true; lockedPack: PresetPack | null; onlyVariables?: string[] }

/**
 * Decide the binding, loading whatever the decision needs.
 *
 * Both interactive callers — the library's file import and sync — go through this, so the policy
 * lives in one place and the components keep only their own dialog plumbing. `database` is
 * reached from here rather than from the components for the same reason.
 */
export async function planPackBinding(
  ctx: PackBindingContext,
  legacyImportPackMapping: boolean,
): Promise<PackPromptPlan> {
  const matched = ctx.match.pack
  const [packs, matchedPackVariables] = await Promise.all([
    database.getAllPacks(),
    matched ? database.getPackVariables(matched.id) : Promise.resolve(undefined),
  ])

  const decision = decidePackPrompt(ctx, {
    legacyImportPackMapping,
    packCount: packs.length,
    matchedPackVariables,
  })

  if (decision.prompt === 'none') {
    return {
      ask: false,
      resolution: await autoMatchPackBinding(ctx, matchedPackVariables),
    }
  }

  // On `fill-values` the pack is settled; only the gap is up for discussion.
  return decision.prompt === 'fill-values'
    ? { ask: true, lockedPack: matched, onlyVariables: decision.missing }
    : { ask: true, lockedPack: null }
}

/**
 * The headless fallback, used when a caller supplies no resolver.
 *
 * Both real callers are interactive and ask when `decidePackPrompt` says to, so this only runs
 * where there is nobody to ask. It binds on a confident match and otherwise falls back to the
 * built-in pack — a usable story bound by default, which is the most a caller with no user
 * attached can honestly produce.
 *
 * A name-only match does not bind silently: `preset_packs` has `UNIQUE(name)`, so one candidate
 * means unambiguous, not right, and two people can both call a pack "Grimdark".
 */
export async function autoMatchPackBinding(
  ctx: PackBindingContext,
  knownTargetVariables?: Array<{ variableName: string }>,
): Promise<PackBindingResolution> {
  const values = ctx.binding?.customVariableValues
  const packId =
    ctx.match.confidence === 'exact' && ctx.match.pack ? ctx.match.pack.id : DEFAULT_PACK_ID
  if (!values) return { packId }

  const targetVariables = knownTargetVariables ?? (await database.getPackVariables(packId))
  const canonicalValues = canonicalizeCustomVariableValues(values, targetVariables)
  return { packId, customVariableValues: canonicalValues }
}
