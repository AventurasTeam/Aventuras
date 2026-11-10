import { nameIdsInProse } from '@/lib/classifier'
import { IdBiMap, SUBSTITUTABLE_PREFIXES } from '@/lib/ids'
import { isJsonObject } from '@/lib/json-object'

export const TURN_PREFIX = 'entry_'
const AWARENESS_PREFIX = 'haw_'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const SHOWN_KINDS = [...SUBSTITUTABLE_PREFIXES, 'entry', 'haw'].join('|')
const FULL_ID_IN_TEXT = new RegExp(`\\b(?:${SHOWN_KINDS})_${UUID}\\b`, 'g')
const FULL_ID = new RegExp(`^(?:${SHOWN_KINDS})_${UUID}$`)
// generateId's exact shape: any id the model has no handle for.
const GENERATED_ID =
  /\b[a-z][a-z0-9]*_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/g
const BRANCH_QUALIFIER = new RegExp(`\\bbr_${UUID}:`, 'g')
const BRACKETED = /^\[([^[\]]+)\]$/

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function requirePrefix(id: string, prefix: string): void {
  if (!id.startsWith(prefix)) throw new TypeError(`Expected a ${prefix} id: ${id}`)
}

/**
 * A close's one id map: a row keeps its handle across steps, tasks and parts, the chapter's turns
 * read t1…tN by position and awareness rows aw1…. `show` takes a substitutable `prefix_<uuid>` id
 * only, and throws for any other.
 */
export class CloseIds {
  private readonly map = new IdBiMap()
  private readonly names = new Map<string, string>()
  private turnCount = 0
  private awarenessCount = 0
  // Registered ids FULL_ID_IN_TEXT can't see, such as a seeded `entry_long_20_0001`.
  private readonly unpatterned = new Map<string, string>()
  private unpatternedInText: RegExp | null = null

  /** A row the model sees: its handle (c1, lo2, th1…), its name kept for nameOf. */
  show(id: string, name: string): string {
    const handle = this.map.allocate(id)
    this.names.set(id, name)
    return handle
  }

  /** The chapter's entries as t1…tN by position; a second call with the same ids is a no-op. */
  showTurns(entryIds: readonly string[]): void {
    this.requireTurnList(entryIds)
    entryIds.forEach((id, i) => this.register(`t${i + 1}`, id, TURN_PREFIX))
    this.turnCount = Math.max(this.turnCount, entryIds.length)
  }

  /** An entry outside the chapter: the next t handle, or its existing one. */
  showTurn(entryId: string): string {
    requirePrefix(entryId, TURN_PREFIX)
    const held = this.map.getPlaceholderFor(entryId)
    if (held !== undefined) return held
    this.turnCount += 1
    return this.register(`t${this.turnCount}`, entryId, TURN_PREFIX)
  }

  /** A happening_awareness row: aw1…, the same handle each time. */
  showAwareness(id: string): string {
    requirePrefix(id, AWARENESS_PREFIX)
    const held = this.map.getPlaceholderFor(id)
    if (held !== undefined) return held
    this.awarenessCount += 1
    return this.register(`aw${this.awarenessCount}`, id, AWARENESS_PREFIX)
  }

  handleOf(id: string): string | undefined {
    return this.map.getPlaceholderFor(id)
  }

  /** Strict: undefined for a handle never shown; a bracketed copy reads as the bare handle. */
  idOf(handle: string): string | undefined {
    const id = this.map.getUuidFor(handle)
    if (id !== undefined) return id
    const bare = BRACKETED.exec(handle)?.[1]
    return bare === undefined ? undefined : this.map.getUuidFor(bare)
  }

  /** A row handle's name, for nameIdsInProse; undefined for turns and awareness rows. */
  nameOf(token: string): string | undefined {
    const id = this.map.getUuidFor(token)
    const name = id === undefined ? undefined : this.names.get(id)
    return name?.trim() || undefined
  }

  /** A row handle text minted with no name: its full id, which prose keeps where a handle can't. */
  citedIdOf(token: string): string | undefined {
    const id = this.map.getUuidFor(token)
    if (id === undefined || this.names.has(id)) return undefined
    return id.startsWith(TURN_PREFIX) || id.startsWith(AWARENESS_PREFIX) ? undefined : id
  }

  /** Full ids in `text` as handles; a `br_` qualifier is dropped, any other id becomes "a row". */
  withHandles(text: string): string {
    return this.withUnpatterned(text.replace(FULL_ID_IN_TEXT, (id) => this.handleInText(id)))
      .replace(BRANCH_QUALIFIER, '')
      .replace(GENERATED_ID, 'a row')
  }

  /** A full id's name, through its handle; undefined when never shown. */
  nameOfId(id: string): string | undefined {
    const handle = this.handleOf(id)
    return handle === undefined ? undefined : this.nameOf(handle)
  }

  private withUnpatterned(text: string): string {
    if (this.unpatterned.size === 0) return text
    this.unpatternedInText ??= new RegExp(
      `(^|[^\\w-])(${[...this.unpatterned.keys()]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join('|')})(?![\\w-])`,
      'g',
    )
    return text.replace(
      this.unpatternedInText,
      (_match, lead: string, id: string) => `${lead}${this.unpatterned.get(id) ?? id}`,
    )
  }

  private handleInText(id: string): string {
    if (id.startsWith(TURN_PREFIX)) return this.showTurn(id)
    if (id.startsWith(AWARENESS_PREFIX)) return this.showAwareness(id)
    return this.map.allocate(id)
  }

  // Checked up front: register throwing mid-list would leave earlier handles set.
  private requireTurnList(entryIds: readonly string[]): void {
    entryIds.forEach((id) => requirePrefix(id, TURN_PREFIX))
    if (new Set(entryIds).size !== entryIds.length) throw new Error('Turn ids repeat in one list')
  }

  private register(handle: string, id: string, prefix: string): string {
    requirePrefix(id, prefix)
    this.map.registerHandle(handle, id)
    if (!FULL_ID.test(id) && !this.unpatterned.has(id)) {
      this.unpatterned.set(id, handle)
      this.unpatternedInText = null
    }
    return handle
  }
}

/** nameIdsInProse with this run's names: a handle in `why` or a text field is stored as its name. */
export function nameCloseProse<T>(value: T, ids: CloseIds): T {
  return nameIdsInProse(value, (token) => ids.nameOf(token) ?? ids.citedIdOf(token))
}

const hasToJson = (value: object): value is { toJSON: () => unknown } =>
  typeof (value as { toJSON?: unknown }).toJSON === 'function'

const isPlain = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Walks a value as JSON.stringify sees it, keys included, so no full id survives. A non-plain
 * object without toJSON (a Map) is left for the task loop's JSON check to refuse (a copy reads {}).
 */
export function withHandlesDeep(value: unknown, ids: CloseIds): unknown {
  if (typeof value === 'string') return ids.withHandles(value)
  if (Array.isArray(value)) return value.map((item) => withHandlesDeep(item, ids))
  if (isJsonObject(value)) {
    if (hasToJson(value)) return withHandlesDeep(value.toJSON(), ids)
    if (!isPlain(value)) return value
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        ids.withHandles(key),
        withHandlesDeep(item, ids),
      ]),
    )
  }
  return value
}
