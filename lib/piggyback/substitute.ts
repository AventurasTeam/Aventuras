import { MalformedPlaceholderError, type IdBiMap } from '@/lib/ids'

import { isCreateHandle, unwrapBracket } from './tags'
import type {
  NewLocationEmission,
  ParsedTransfers,
  ParseFieldFailure,
  ParsedStateBlock,
} from './types'

type SubstituteResult = { block: ParsedStateBlock; failures: ParseFieldFailure[] }

// Strict by design: the classifier's contract is that it only ever
// references entities it was actually shown, so anything that doesn't
// resolve to a known placeholder — malformed-looking or not — must fail
// rather than fall through as a literal string into metadata/DB.
function resolveRef(ref: string, idMap: IdBiMap): string {
  const uuid = idMap.getUuidFor(unwrapBracket(ref))
  if (uuid === undefined) throw new MalformedPlaceholderError(ref)
  return uuid
}

// A `new:` ref stays a handle only if this block's creates declare it; else it fails its field.
function resolveRefOrHandle(ref: string, idMap: IdBiMap, handles: ReadonlySet<string>): string {
  const bare = unwrapBracket(ref)
  if (!isCreateHandle(bare)) return resolveRef(ref, idMap)
  if (handles.has(bare)) return bare
  throw new MalformedPlaceholderError(ref)
}

// Lenient: the planner drops a parent it can't resolve to the root rather than failing the turn.
function resolveParent(ref: string, idMap: IdBiMap): string {
  const bare = unwrapBracket(ref)
  if (isCreateHandle(bare)) return bare
  return idMap.getUuidFor(bare) ?? ref
}

function withResolvedParent(create: NewLocationEmission, idMap: IdBiMap): NewLocationEmission {
  return create.parent === undefined
    ? create
    : { ...create, parent: resolveParent(create.parent, idMap) }
}

/** Expects normalized creates (trimmed handles): the fallback runs `normalizeCreates` first. */
function declaredHandles(block: ParsedStateBlock): ReadonlySet<string> {
  return new Set([...(block.newLocations ?? []), ...(block.newItems ?? [])].map((c) => c.handle))
}

// A transfer's item may be one this block creates; its holders are always listed entities.
function resolveTransfers(
  transfers: ParsedTransfers,
  idMap: IdBiMap,
  handles: ReadonlySet<string>,
): ParsedTransfers {
  return {
    items: transfers.items.map((item) => ({
      ...item,
      id: resolveRefOrHandle(item.id, idMap, handles),
      ...(item.to !== undefined ? { to: resolveRef(item.to, idMap) } : {}),
      ...(item.from !== undefined ? { from: resolveRef(item.from, idMap) } : {}),
    })),
    stackables: transfers.stackables.map((s) => ({
      ...s,
      ...(s.to !== undefined ? { to: resolveRef(s.to, idMap) } : {}),
      ...(s.from !== undefined ? { from: resolveRef(s.from, idMap) } : {}),
    })),
  }
}

function resolveField<K extends keyof ParsedStateBlock>(
  block: ParsedStateBlock,
  field: K,
  resolve: (value: NonNullable<ParsedStateBlock[K]>, idMap: IdBiMap) => ParsedStateBlock[K],
  idMap: IdBiMap,
  failures: ParseFieldFailure[],
): void {
  const value = block[field]
  if (value === undefined) return
  try {
    block[field] = resolve(value, idMap)
  } catch (e) {
    delete block[field]
    failures.push({
      field,
      detail: e instanceof MalformedPlaceholderError ? e.message : String(e),
    })
  }
}

// Resolves only ID-bearing sub-fields, never a create's name or description: a bad id, to or from
// fails only its own field, and a bad create parent fails nothing, since `resolveParent` is lenient
// (docs/memory/piggyback.md → Parse strategy and failure recovery).
export function substitutePiggybackIds(block: ParsedStateBlock, idMap: IdBiMap): SubstituteResult {
  const result: ParsedStateBlock = { ...block }
  const failures: ParseFieldFailure[] = []
  const handles = declaredHandles(block)

  resolveField(
    result,
    'sceneEntities',
    (ids, m) => ids.map((id) => resolveRefOrHandle(id, m, handles)),
    idMap,
    failures,
  )
  resolveField(
    result,
    'currentLocation',
    (id, m) => resolveRefOrHandle(id, m, handles),
    idMap,
    failures,
  )
  resolveField(
    result,
    'visualChanges',
    (notes, m) => notes.map((n) => ({ ...n, id: resolveRef(n.id, m) })),
    idMap,
    failures,
  )
  resolveField(
    result,
    'transfers',
    (transfers, m) => resolveTransfers(transfers, m, handles),
    idMap,
    failures,
  )
  if (result.newLocations !== undefined)
    result.newLocations = result.newLocations.map((create) => withResolvedParent(create, idMap))

  return { block: result, failures }
}
