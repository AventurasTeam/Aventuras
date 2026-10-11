import type { Entity } from '@/lib/db'
import { MalformedPlaceholderError, type IdBiMap } from '@/lib/ids'

import { isCreateHandle, unwrapBracket } from './tags'
import type {
  ItemTransfer,
  NewLocationEmission,
  NormalizedStateBlock,
  ParsedTransfers,
  ParseFieldFailure,
  ParsedStateBlock,
  StackableTransfer,
  SubstitutedStateBlock,
} from './types'

type EntityKind = Entity['kind']

/** A transfer as emitted, dropped for a ref that doesn't resolve or names no item. */
type DroppedTransfer = { transfer: ItemTransfer | StackableTransfer; detail: string }

type SubstituteResult = {
  block: SubstitutedStateBlock
  failures: ParseFieldFailure[]
  /** Empty unless `badRef` is `'drop'`. */
  droppedTransfers: DroppedTransfer[]
}

type SubstituteOptions = {
  /** The branch's entities, so a transfer's item can be checked to name an item. */
  entities: readonly Pick<Entity, 'id' | 'kind'>[]
  /**
   * `'fail'` (the narrative fold, whose failure fires the fallback): a bad or wrong-kind ref fails
   * its field. `'drop'` (the fallback, which nothing rereads): a transfer with one drops alone, and
   * a new item's handle as the location is left for apply.ts to reject.
   */
  badRef: 'fail' | 'drop'
}

type Refs = {
  idMap: IdBiMap
  /** Each declared handle, by the kind of create declaring it. */
  handles: ReadonlyMap<string, 'location' | 'item'>
  kinds: ReadonlyMap<string, EntityKind>
}

const kindPhrase = (kind: EntityKind | null) =>
  kind === null ? 'no entity' : kind === 'item' ? 'an item' : `a ${kind}`

class WrongKindError extends Error {
  constructor(ref: string, kind: EntityKind | null, expected: 'location' | 'item') {
    super(`${ref} names ${kindPhrase(kind)}, not ${kindPhrase(expected)}`)
    this.name = 'WrongKindError'
  }
}

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
function resolveRefOrHandle(ref: string, refs: Refs): string {
  const bare = unwrapBracket(ref)
  if (!isCreateHandle(bare)) return resolveRef(ref, refs.idMap)
  if (refs.handles.has(bare)) return bare
  throw new MalformedPlaceholderError(ref)
}

function kindOf(resolved: string, refs: Refs): EntityKind | null {
  return refs.handles.get(resolved) ?? refs.kinds.get(resolved) ?? null
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

function declaredHandles(block: NormalizedStateBlock): ReadonlyMap<string, 'location' | 'item'> {
  return new Map([
    ...(block.newLocations ?? []).map((c) => [c.handle, 'location'] as const),
    ...(block.newItems ?? []).map((c) => [c.handle, 'item'] as const),
  ])
}

// A transfer's item may be one this block creates; its holders are always listed entities.
function resolveItemTransfer(item: ItemTransfer, refs: Refs): ItemTransfer {
  const resolved = {
    ...item,
    id: resolveRefOrHandle(item.id, refs),
    ...(item.to !== undefined ? { to: resolveRef(item.to, refs.idMap) } : {}),
    ...(item.from !== undefined ? { from: resolveRef(item.from, refs.idMap) } : {}),
  }
  const kind = kindOf(resolved.id, refs)
  if (kind !== 'item') throw new WrongKindError(item.id, kind, 'item')
  return resolved
}

function resolveStackable(s: StackableTransfer, idMap: IdBiMap): StackableTransfer {
  return {
    ...s,
    ...(s.to !== undefined ? { to: resolveRef(s.to, idMap) } : {}),
    ...(s.from !== undefined ? { from: resolveRef(s.from, idMap) } : {}),
  }
}

function resolveTransfers(
  transfers: ParsedTransfers,
  refs: Refs,
  badRef: SubstituteOptions['badRef'],
  dropped: DroppedTransfer[],
): ParsedTransfers {
  const settle = <T extends ItemTransfer | StackableTransfer>(
    transfer: T,
    resolve: (transfer: T) => T,
  ): T[] => {
    try {
      return [resolve(transfer)]
    } catch (e) {
      const unresolved = e instanceof MalformedPlaceholderError || e instanceof WrongKindError
      if (badRef === 'fail' || !unresolved) throw e
      dropped.push({ transfer, detail: e.message })
      return []
    }
  }
  return {
    items: transfers.items.flatMap((item) => settle(item, (i) => resolveItemTransfer(i, refs))),
    stackables: transfers.stackables.flatMap((s) =>
      settle(s, (x) => resolveStackable(x, refs.idMap)),
    ),
  }
}

// An item's id is left for apply.ts to reject, keeping the previous location, and so is an item's
// handle under `badRef: 'drop'`.
function resolveLocation(ref: string, refs: Refs, badRef: SubstituteOptions['badRef']): string {
  const resolved = resolveRefOrHandle(ref, refs)
  if (badRef === 'fail' && refs.handles.get(resolved) === 'item')
    throw new WrongKindError(ref, 'item', 'location')
  return resolved
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
    failures.push({ field, detail: e instanceof Error ? e.message : String(e) })
  }
}

// Resolves only ID-bearing sub-fields: a bad or wrong-kind ref fails its own field, or under
// `badRef: 'drop'` only its transfer; a bad create parent fails nothing (`resolveParent`).
// docs/memory/piggyback.md → Where a handle is used, Parse strategy and failure recovery
export function substitutePiggybackIds(
  block: NormalizedStateBlock,
  idMap: IdBiMap,
  options: SubstituteOptions,
): SubstituteResult {
  const result: ParsedStateBlock = { ...block }
  const failures: ParseFieldFailure[] = []
  const droppedTransfers: DroppedTransfer[] = []
  const refs: Refs = {
    idMap,
    handles: declaredHandles(block),
    kinds: new Map(options.entities.map((e) => [e.id, e.kind])),
  }

  resolveField(
    result,
    'sceneEntities',
    (ids) => ids.map((id) => resolveRefOrHandle(id, refs)),
    idMap,
    failures,
  )
  resolveField(
    result,
    'currentLocation',
    (id) => resolveLocation(id, refs, options.badRef),
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
    (transfers) => resolveTransfers(transfers, refs, options.badRef, droppedTransfers),
    idMap,
    failures,
  )
  if (result.newLocations !== undefined)
    result.newLocations = result.newLocations.map((create) => withResolvedParent(create, idMap))

  return { block: result as SubstitutedStateBlock, failures, droppedTransfers }
}
