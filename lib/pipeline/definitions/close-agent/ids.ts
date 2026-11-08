import { nameIdsInProse } from '@/lib/classifier'
import { IdBiMap, SUBSTITUTABLE_PREFIXES } from '@/lib/ids'

const TURN_PREFIX = 'entry_'
const AWARENESS_PREFIX = 'haw_'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const SHOWN_KINDS = [...SUBSTITUTABLE_PREFIXES, 'entry', 'haw'].join('|')
const FULL_ID_IN_TEXT = new RegExp(`\\b(?:${SHOWN_KINDS})_${UUID}\\b`, 'g')
const FULL_ID = new RegExp(`^(?:${SHOWN_KINDS})_${UUID}$`)
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
  private readonly map: IdBiMap
  private readonly names = new Map<string, string>()
  private turnCount = 0
  private awarenessCount = 0
  // Registered ids FULL_ID_IN_TEXT can't see, such as a seeded `entry_long_20_0001`.
  private readonly unpatterned = new Map<string, string>()
  private unpatternedInText: RegExp | null = null

  constructor(map: IdBiMap = new IdBiMap()) {
    this.map = map
  }

  /** A row the model sees: its handle (c1, lo2, th1…), its name kept for nameOf. */
  show(id: string, name: string): string {
    const handle = this.map.allocate(id)
    this.names.set(id, name)
    return handle
  }

  /** The chapter's entries as t1…tN by position; a second call with the same ids is a no-op. */
  showTurns(entryIds: readonly string[]): void {
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
    return name?.trim() ? name : undefined
  }

  /** Every full id in `text` swapped for its handle. */
  withHandles(text: string): string {
    const swapped = text.replace(FULL_ID_IN_TEXT, (id) => this.handleInText(id))
    if (this.unpatterned.size === 0) return swapped
    this.unpatternedInText ??= new RegExp(
      `(^|[^\\w-])(${[...this.unpatterned.keys()]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join('|')})(?![\\w-])`,
      'g',
    )
    return swapped.replace(
      this.unpatternedInText,
      (_match, lead: string, id: string) => `${lead}${this.unpatterned.get(id) ?? id}`,
    )
  }

  /** A full id's name, through its handle; undefined when never shown. */
  nameOfId(id: string): string | undefined {
    const handle = this.handleOf(id)
    return handle === undefined ? undefined : this.nameOf(handle)
  }

  private handleInText(id: string): string {
    if (id.startsWith(TURN_PREFIX)) return this.showTurn(id)
    if (id.startsWith(AWARENESS_PREFIX)) return this.showAwareness(id)
    return this.map.allocate(id)
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
  return nameIdsInProse(value, (token) => ids.nameOf(token))
}
