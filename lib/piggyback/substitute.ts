import type { Entity } from '@/lib/db'
import { MalformedPlaceholderError, type IdBiMap } from '@/lib/ids'
import { TOP_LEVEL } from '@/lib/world'

import { isCreateHandle, unwrapBracket } from './tags'
import type {
  DroppedRef,
  DroppedRefField,
  ItemDrop,
  ItemTransfer,
  NewLocationEmission,
  NormalizedStateBlock,
  ParsedTransfers,
  ParsedStateBlock,
  StackableTransfer,
  SubstitutedStateBlock,
} from './types'

type EntityKind = Entity['kind']

type FieldFailure = { field: DroppedRefField; detail: string }

type SubstituteResult = {
  block: SubstitutedStateBlock
  failures: FieldFailure[]
  /** Empty unless `badRef` is `'drop'`. */
  droppedRefs: DroppedRef[]
}

type SubstituteOptions = {
  /** The branch's entities, to kind-check scene ids, visual changes and a transfer's item. */
  entities: readonly Pick<Entity, 'id' | 'kind'>[]
  /**
   * `'fail'` (the narrative fold, whose failure fires the fallback): a bad or wrong-kind ref fails
   * its field. `'drop'` (the fallback, which nothing rereads): an entry with one drops alone and is
   * recorded, and a new item's handle as the location is left for apply.ts to reject.
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
  constructor(
    readonly ref: string,
    /** What `ref` resolved to: a row's id, or a create's handle. */
    readonly resolved: string,
    readonly kind: EntityKind | null,
    expected: readonly EntityKind[],
  ) {
    super(`${ref} names ${kindPhrase(kind)}, not ${expected.map(kindPhrase).join(' or ')}`)
    this.name = 'WrongKindError'
  }
}

// data-model.md → Entry metadata shape: the scene holds characters and items, an item one this
// block creates included; only a character carries visual state.
const SCENE_KINDS: readonly EntityKind[] = ['character', 'item']
const VISUAL_KINDS: readonly EntityKind[] = ['character']

function requireKind(ref: string, resolved: string, refs: Refs, kinds: readonly EntityKind[]) {
  const kind = kindOf(resolved, refs)
  if (kind === null || !kinds.includes(kind)) throw new WrongKindError(ref, resolved, kind, kinds)
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

// piggyback.md → Parent: the token a tag or the fallback's JSON gives for a top-level place.
const PARENT_TOP = 'top'

// Lenient: the planner leaves the place unplaced for an unresolvable parent, not failing the turn.
function resolveParent(ref: string, idMap: IdBiMap): string {
  const bare = unwrapBracket(ref)
  if (bare.toLowerCase() === PARENT_TOP) return TOP_LEVEL
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

// A moved or put-down item may be one this block creates; its holders are always listed entities.
function resolveItemMove<T extends { id: string; to?: string; from?: string }>(
  move: T,
  refs: Refs,
): T {
  const resolved = {
    ...move,
    id: resolveRefOrHandle(move.id, refs),
    ...(move.to !== undefined ? { to: resolveRef(move.to, refs.idMap) } : {}),
    ...(move.from !== undefined ? { from: resolveRef(move.from, refs.idMap) } : {}),
  }
  requireKind(move.id, resolved.id, refs, ['item'])
  return resolved
}

// A drop lands wherever its holder is, never reading `from`: one that names no one is left off
// rather than costing the drop.
function withKnownFrom(drop: ItemDrop, idMap: IdBiMap): ItemDrop {
  if (drop.from === undefined || idMap.getUuidFor(unwrapBracket(drop.from)) !== undefined)
    return drop
  const { from: _unknown, ...rest } = drop
  return rest
}

function resolveStackable(s: StackableTransfer, idMap: IdBiMap): StackableTransfer {
  return {
    ...s,
    ...(s.to !== undefined ? { to: resolveRef(s.to, idMap) } : {}),
    ...(s.from !== undefined ? { from: resolveRef(s.from, idMap) } : {}),
  }
}

type Settle = <T>(field: DroppedRefField, entry: T, resolve: (entry: T) => T) => T[]

// Under `'drop'` an entry with a ref that doesn't resolve or names the wrong kind drops alone and is
// recorded; under `'fail'`, or for any other error, it throws and fails the field.
function settler(badRef: SubstituteOptions['badRef'], dropped: DroppedRef[]): Settle {
  return (field, entry, resolve) => {
    try {
      return [resolve(entry)]
    } catch (e) {
      if (badRef === 'fail') throw e
      if (e instanceof MalformedPlaceholderError)
        dropped.push({ field, ref: e.placeholder, reason: 'unknown', detail: e.message })
      else if (e instanceof WrongKindError)
        dropped.push({
          field,
          ref: e.ref,
          ...(isCreateHandle(e.resolved) ? {} : { id: e.resolved }),
          ...(e.kind !== null ? { kind: e.kind } : {}),
          reason: 'wrong-kind',
          detail: e.message,
        })
      else throw e
      return []
    }
  }
}

function resolveTransfers(transfers: ParsedTransfers, refs: Refs, settle: Settle): ParsedTransfers {
  return {
    items: transfers.items.flatMap((item: ItemTransfer) =>
      settle('transfers', item, (i) => resolveItemMove(i, refs)),
    ),
    stackables: transfers.stackables.flatMap((s: StackableTransfer) =>
      settle('transfers', s, (x) => resolveStackable(x, refs.idMap)),
    ),
    drops: transfers.drops.flatMap((drop: ItemDrop) =>
      settle('transfers', drop, (d) => resolveItemMove(withKnownFrom(d, refs.idMap), refs)),
    ),
  }
}

// An item's id is left for apply.ts to reject, keeping the previous location, and so is an item's
// handle under `badRef: 'drop'`.
function resolveLocation(ref: string, refs: Refs, badRef: SubstituteOptions['badRef']): string {
  const resolved = resolveRefOrHandle(ref, refs)
  if (badRef === 'fail' && refs.handles.get(resolved) === 'item')
    throw new WrongKindError(ref, resolved, 'item', ['location'])
  return resolved
}

function resolveField<K extends DroppedRefField>(
  block: ParsedStateBlock,
  field: K,
  resolve: (value: NonNullable<ParsedStateBlock[K]>) => ParsedStateBlock[K],
  failures: FieldFailure[],
): void {
  const value = block[field]
  if (value === undefined) return
  try {
    block[field] = resolve(value)
  } catch (e) {
    delete block[field]
    failures.push({ field, detail: e instanceof Error ? e.message : String(e) })
  }
}

// Resolves only ID-bearing sub-fields: a bad or wrong-kind ref fails its own field, or under
// `badRef: 'drop'` only its entry; a bad create parent fails nothing (`resolveParent`).
// docs/memory/piggyback.md → Where a handle is used, Parse strategy and failure recovery
export function substitutePiggybackIds(
  block: NormalizedStateBlock,
  idMap: IdBiMap,
  options: SubstituteOptions,
): SubstituteResult {
  const result: ParsedStateBlock = { ...block }
  const failures: FieldFailure[] = []
  const droppedRefs: DroppedRef[] = []
  const settle = settler(options.badRef, droppedRefs)
  const refs: Refs = {
    idMap,
    handles: declaredHandles(block),
    kinds: new Map(options.entities.map((e) => [e.id, e.kind])),
  }

  // A list every entry dropped from reads as omitted, as a dropped location does: the previous
  // scene stays rather than emptying on a reply that named no one usably.
  resolveField(
    result,
    'sceneEntities',
    (ids) => {
      const kept = ids.flatMap((id) =>
        settle('sceneEntities', id, (ref) => {
          const resolved = resolveRefOrHandle(ref, refs)
          requireKind(ref, resolved, refs, SCENE_KINDS)
          return resolved
        }),
      )
      return ids.length > 0 && kept.length === 0 ? undefined : kept
    },
    failures,
  )
  // A dropped location reads as omitted: the previous one stays, as a field failure would leave it.
  resolveField(
    result,
    'currentLocation',
    (id) => settle('currentLocation', id, (ref) => resolveLocation(ref, refs, options.badRef))[0],
    failures,
  )
  resolveField(
    result,
    'visualChanges',
    (notes) =>
      notes.flatMap((n) =>
        settle('visualChanges', n, (note) => {
          const id = resolveRef(note.id, idMap)
          requireKind(note.id, id, refs, VISUAL_KINDS)
          return { ...note, id }
        }),
      ),
    failures,
  )
  resolveField(
    result,
    'conditions',
    (changes) =>
      changes.flatMap((c) =>
        settle('conditions', c, (change) => ({
          ...change,
          id: resolveRef(change.id, idMap),
        })),
      ),
    failures,
  )
  resolveField(
    result,
    'transfers',
    (transfers) => resolveTransfers(transfers, refs, settle),
    failures,
  )
  if (result.currentLocation === undefined) delete result.currentLocation
  if (result.newLocations !== undefined)
    result.newLocations = result.newLocations.map((create) => withResolvedParent(create, idMap))

  return { block: result as SubstitutedStateBlock, failures, droppedRefs }
}
