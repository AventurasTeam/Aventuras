/**
 * Binding a story to a prompt pack.
 *
 * A pack's id is assigned locally -- `crypto.randomUUID()` when it is created and again when a
 * `.prompt.json` is imported -- so the same pack installed on two devices has two different ids.
 * Nothing that crosses a device boundary can therefore match on id; identity is the pack's name
 * and author, and the values a story holds are re-keyed to the local definitions by name.
 *
 * One implementation, two callers: file import and sync, both of which put a dialog in front of
 * the user when the match is anything short of certain.
 *
 * Re-binding a story that already exists is a pending capability and deliberately absent here —
 * the service call it will need is better written against that change's requirements than
 * guessed at now.
 */

import { database } from '$lib/services/database'
import type { PresetPack, RuntimeVarsMap, RuntimeEntityType } from './types'

/**
 * The built-in pack. `preset_packs` always contains it (`PackService.initialize` recreates it if
 * it is missing), so it is the one binding that is always available to fall back to.
 */
export const DEFAULT_PACK_ID = 'default-pack'

/** How a pack recorded in a story file is named. `author` is optional on a pack. */
export interface PackIdentity {
  name: string
  author: string | null
}

/**
 * How sure we are that a local pack is *the* pack a story was written with.
 *
 * `name-only` exists because `preset_packs` has `UNIQUE(name)`: a name lookup returns at most
 * one candidate, which guarantees the match is unambiguous, not that it is right. Two people can
 * both publish a pack called "Grimdark". So a name-only hit is a suggestion to show the user,
 * never something to bind on silently.
 */
export type MatchConfidence = 'exact' | 'name-only' | 'none'

export interface PackMatch {
  pack: PresetPack | null
  confidence: MatchConfidence
}

/** Trim and case-fold for comparison; a missing author is the same value as an empty one. */
function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/**
 * Find the local pack a story file's pack identity refers to.
 *
 * Pass `packs` when the list is already loaded (the dialog has it); it is fetched otherwise.
 */
export async function matchPack(
  identity: PackIdentity | null | undefined,
  packs?: PresetPack[],
): Promise<PackMatch> {
  const name = normalize(identity?.name)
  if (!name) return { pack: null, confidence: 'none' }

  const candidates = packs ?? (await database.getAllPacks())
  const byName = candidates.find((p) => normalize(p.name) === name)
  if (!byName) return { pack: null, confidence: 'none' }

  const authorMatches = normalize(byName.author) === normalize(identity?.author)
  return { pack: byName, confidence: authorMatches ? 'exact' : 'name-only' }
}

/** The subset of a runtime variable definition that matching needs, from either side. */
export interface RuntimeVarDef {
  entityType: RuntimeEntityType
  variableName: string
}

/** A local runtime variable definition, which additionally carries the key to write. */
export interface LocalRuntimeVarDef extends RuntimeVarDef {
  id: string
}

/**
 * Which local definition each source variable name maps to, for one entity type.
 *
 * The source definitions travel without ids, so they cannot be looked up by the key the stored
 * values use. What they establish is that the source pack *defined* this name for this entity
 * type -- the pairing the spec describes -- while the value's own `variableName`, written
 * alongside every stored value, is what carries the name across.
 */
function pairByName(
  entityType: RuntimeEntityType,
  sourceDefs: RuntimeVarDef[],
  targetDefs: LocalRuntimeVarDef[],
): Map<string, string> {
  const sourceNames = new Set(
    sourceDefs.filter((d) => d.entityType === entityType).map((d) => normalize(d.variableName)),
  )
  const pairs = new Map<string, string>()
  for (const def of targetDefs) {
    if (def.entityType !== entityType) continue
    const name = normalize(def.variableName)
    if (sourceNames.has(name)) pairs.set(name, def.id)
  }
  return pairs
}

/**
 * Re-key one entity's stored runtime variable values for a different pack's definitions.
 *
 * `metadata.runtimeVars` is keyed by the *definition's* id, which makes renaming a variable free
 * on one device and makes every value unreadable on any other. This finds the local definition
 * with the same `(entityType, variableName)` as a source one and writes the value under the local
 * id as well.
 *
 * `entityType` is a parameter rather than something read off `metadata`, because metadata does
 * not record what it is attached to and a pack may define the same variable name for characters
 * and for locations. Without it, a character's value could be re-keyed onto a location's
 * definition.
 *
 * Additive on purpose: the source key is left in place. Keys are UUIDs and cannot collide, an
 * unused entry costs a short `{variableName, v}` pair, and keeping it is what makes a re-binding
 * reversible -- bind the story back to the original pack and the original values are readable
 * again rather than gone. Pruning would destroy exactly the data this exists to protect.
 *
 * Returns `metadata` untouched (same reference) when there is nothing to remap, so callers can
 * hand it straight back to the row they were going to write anyway.
 */
export function remapRuntimeVars<T extends Record<string, unknown> | null | undefined>(
  metadata: T,
  entityType: RuntimeEntityType,
  sourceDefs: RuntimeVarDef[] | undefined,
  targetDefs: LocalRuntimeVarDef[] | undefined,
): T {
  if (!metadata || !sourceDefs?.length || !targetDefs?.length) return metadata

  const existing = metadata.runtimeVars as RuntimeVarsMap | undefined
  if (!existing || Object.keys(existing).length === 0) return metadata

  const pairs = pairByName(entityType, sourceDefs, targetDefs)
  if (pairs.size === 0) return metadata

  const added: RuntimeVarsMap = {}
  for (const [defId, value] of Object.entries(existing)) {
    if (!value || typeof value.variableName !== 'string') continue
    const targetId = pairs.get(normalize(value.variableName))
    if (!targetId || targetId === defId) continue
    added[targetId] = { variableName: value.variableName, v: value.v }
  }

  if (Object.keys(added).length === 0) return metadata
  return { ...metadata, runtimeVars: { ...existing, ...added } }
}
