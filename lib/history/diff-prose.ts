import { termChanges, termKeyOf, termMatchOf, type TermMatch } from '@/lib/actions'
import { INJECTION_MODES, THREAD_STATUSES } from '@/lib/db'
import { t } from '@/lib/i18n'
import { isJsonObject } from '@/lib/json-object'
import { oneLine } from '@/lib/text'
import { ENTITY_STATUSES } from '@/lib/world'

import type { DiffCacheEntry } from './diff-walk'
import { fieldPathLabel } from './field-labels'
import {
  diffPaths,
  proseFieldOf,
  valueAt,
  type DiffTable,
  type ProseFieldKind,
} from './prose-fields'

/** The table whose labels a clause takes, and for a relationship row the tab's side of it. */
export type ProseTarget =
  | { table: 'character_relationships'; side: 'a' | 'b' }
  | { table: Exclude<DiffTable, 'character_relationships'>; side: null }

export type ProseContext = ProseTarget & {
  /** The working set's name for the row on the tab's branch, or null when the working set lacks it. */
  liveName: (id: string) => string | null
  /** `entry #n` for an entry the branch's index holds, else null. */
  entryLabel: (entryId: string) => string | null
}

// One path's verdict: its change, SAME when its two sides are equal, or null when it has no wording.
const SAME = Symbol('same')
type Change = string | typeof SAME | null

type At = {
  readonly path: string
  readonly old: unknown
  readonly new: unknown
  readonly entry: DiffCacheEntry
}

// A column group renders once, at whichever of its paths the payload lists first.
const GROUP_KINDS: ReadonlySet<ProseFieldKind> = new Set<ProseFieldKind>(['placement', 'collision'])

const LONG_TEXT_MAX = 40
const LONG_TEXT_LEAD = 16

type FilledKey =
  | 'history:prose.clause'
  | 'history:prose.changed'
  | 'history:prose.quoted'
  | 'history:prose.added'
  | 'history:prose.removed'
  | 'history:prose.respelled'
  | 'history:prose.respelledPair'
  | 'history:prose.quantity'
  | 'history:prose.lastSeen'
  | 'history:prose.lastSeenNoPlace'
  | 'history:prose.deletedName'

const SLOT = /\uE000(\d+)\uE001/g

// i18next fills a placeholder at the first match of its text, even inside a value it inserted, so
// t() sees private-use slot marks and each value replaces its mark in one pass, never re-read.
function fill(key: FilledKey, values: Readonly<Record<string, string>>, count?: number): string {
  const names = Object.keys(values)
  const options: Record<string, string | number> = Object.fromEntries(
    names.map((name, i) => [name, `\uE000${i}\uE001`]),
  )
  if (count !== undefined) options.count = count
  return t(key, options).replace(SLOT, (_, i: string) => values[names[Number(i)]])
}

const none = () => t('history:prose.none')
const ellipsis = () => t('history:prose.ellipsis')
const quoted = (text: string) => fill('history:prose.quoted', { text })
const changed = (before: string, after: string) =>
  fill('history:prose.changed', { old: before, new: after })

const isEmpty = (value: unknown) => value == null || value === ''
const sameScalar = (a: unknown, b: unknown) => (isEmpty(a) && isEmpty(b)) || a === b

const isNullableString = (value: unknown): value is string | null | undefined =>
  value == null || typeof value === 'string'

const isNullableNumber = (value: unknown): value is number | null | undefined =>
  value == null || typeof value === 'number'

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return (values as readonly unknown[]).includes(value)
}

function labelOf(path: string, target: ProseTarget): string {
  return target.table === 'character_relationships'
    ? fieldPathLabel(target.table, path, target.side)
    : fieldPathLabel(target.table, path)
}

const isWordStart = (chars: readonly string[], at: number) => at === 0 || chars[at - 1] === ' '

function windowStart(chars: readonly string[], diff: number): number {
  const lead = Math.max(0, diff - LONG_TEXT_LEAD)
  for (let at = lead; at <= diff; at++) if (isWordStart(chars, at)) return at
  return lead
}

function cutSide(chars: readonly string[], start: number, diff: number): string {
  let end = chars.length
  if (end - start > LONG_TEXT_MAX) {
    end = start + LONG_TEXT_MAX
    for (let at = start + LONG_TEXT_MAX; at > diff; at--) {
      if (chars[at] === ' ') {
        end = at
        break
      }
    }
  }
  const head = start > 0 ? ellipsis() : ''
  const tail = end < chars.length ? ellipsis() : ''
  return `${head}${chars.slice(start, end).join('')}${tail}`
}

// world.md → Long text, in code points so no cut splits a surrogate pair.
function cutLongText(before: string, after: string): [string, string] {
  const a = Array.from(before)
  const b = Array.from(after)
  if (a.length <= LONG_TEXT_MAX && b.length <= LONG_TEXT_MAX) return [before, after]
  const shorter = Math.min(a.length, b.length)
  let diff = 0
  while (diff < shorter && a[diff] === b[diff]) diff++
  const start = windowStart(a, diff)
  return [cutSide(a, start, diff), cutSide(b, start, diff)]
}

function textChange({ old, new: next }: At): Change {
  if (!isNullableString(old) || !isNullableString(next)) return null
  const before = oneLine(old ?? '')
  const after = oneLine(next ?? '')
  if (before === after) return SAME
  const [shownBefore, shownAfter] = cutLongText(before, after)
  return changed(
    before === '' ? none() : quoted(shownBefore),
    after === '' ? none() : quoted(shownAfter),
  )
}

type EnumWords = (value: unknown) => string | undefined

const entityStatusWord: EnumWords = (value) =>
  isOneOf(ENTITY_STATUSES, value) ? t(`world:tiers.${value}`) : undefined
const threadStatusWord: EnumWords = (value) =>
  isOneOf(THREAD_STATUSES, value) ? t(`plot:tiers.${value}`) : undefined
const worldInjectionWord: EnumWords = (value) =>
  isOneOf(INJECTION_MODES, value) ? t(`world:fields.injection.${value}`) : undefined
const plotInjectionWord: EnumWords = (value) =>
  isOneOf(INJECTION_MODES, value) ? t(`plot:fields.injection.${value}`) : undefined

// The words the forms' selects show: World's for entities and lore, Plot's for threads.
function enumWords(table: DiffTable, path: string): EnumWords | undefined {
  if (path === 'status') {
    if (table === 'entities') return entityStatusWord
    if (table === 'threads') return threadStatusWord
  }
  if (path === 'injectionMode') {
    if (table === 'entities' || table === 'lore') return worldInjectionWord
    if (table === 'threads') return plotInjectionWord
  }
  return undefined
}

function enumChange({ path, old, new: next }: At, context: ProseContext): Change {
  const words = enumWords(context.table, path)
  if (words === undefined) return null
  if (sameScalar(old, next)) return SAME
  const before = isEmpty(old) ? none() : words(old)
  const after = isEmpty(next) ? none() : words(next)
  return before === undefined || after === undefined ? null : changed(before, after)
}

function numberChange({ old, new: next }: At): Change {
  if (!isNullableNumber(old) || !isNullableNumber(next)) return null
  if (sameScalar(old, next)) return SAME
  return changed(old == null ? none() : String(old), next == null ? none() : String(next))
}

// A 0/1 column, or a boolean-mode one: null is the empty value, anything else has no wording.
function flagOf(value: unknown): boolean | null | undefined {
  if (value == null) return null
  if (value === 1 || value === true) return true
  if (value === 0 || value === false) return false
  return undefined
}

function flagText(flag: boolean | null): string {
  if (flag === null) return none()
  return flag ? t('history:prose.yes') : t('history:prose.no')
}

function flagChange({ old, new: next }: At): Change {
  const before = flagOf(old)
  const after = flagOf(next)
  if (before === undefined || after === undefined) return null
  if (before === after) return SAME
  return changed(flagText(before), flagText(after))
}

const isTermList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

// An absent list is [], as world.md → Change prose compares it.
function listOf(value: unknown): readonly string[] | undefined {
  if (value == null) return []
  return isTermList(value) ? value : undefined
}

function cutTerm(term: string): string {
  const chars = Array.from(oneLine(term))
  if (chars.length <= LONG_TEXT_MAX) return chars.join('')
  const head = chars.slice(0, LONG_TEXT_MAX).join('')
  const wordEnd = chars[LONG_TEXT_MAX] === ' ' ? head.length : head.lastIndexOf(' ')
  return `${wordEnd > 0 ? head.slice(0, wordEnd) : head}${ellipsis()}`
}

// A list is a set: a duplicate is one term, spelled as its first occurrence.
function firstSpellings(list: readonly string[], match: TermMatch): Map<string, string> {
  const byKey = new Map<string, string>()
  for (const term of list) {
    const key = termKeyOf(term, match)
    if (!byKey.has(key)) byKey.set(key, term)
  }
  return byKey
}

// Added and respelled follow the new list's order, removed the old list's; a reorder is no change.
function listParts(
  before: readonly string[],
  after: readonly string[],
  match: TermMatch,
  show: (term: string) => string,
): Change {
  const changes = termChanges(before, after, match)
  if (changes.size === 0) return SAME
  const was = firstSpellings(before, match)
  const now = firstSpellings(after, match)
  const added: string[] = []
  const respelled: string[] = []
  for (const [key, term] of now) {
    const change = changes.get(key)
    if (change === 'added') added.push(show(term))
    else if (change === 'respelled')
      respelled.push(
        fill('history:prose.respelledPair', { old: show(was.get(key) ?? term), new: show(term) }),
      )
  }
  const removed = [...was]
    .filter(([key]) => changes.get(key) === 'removed')
    .map(([, term]) => show(term))
  const separator = t('history:prose.listSeparator')
  const parts: string[] = []
  if (added.length > 0)
    parts.push(fill('history:prose.added', { terms: added.join(separator) }, added.length))
  if (removed.length > 0)
    parts.push(fill('history:prose.removed', { terms: removed.join(separator) }, removed.length))
  if (respelled.length > 0)
    parts.push(
      fill('history:prose.respelled', { pairs: respelled.join(separator) }, respelled.length),
    )
  return parts.join(separator)
}

function termListChange({ path, old, new: next }: At, context: ProseContext): Change {
  const before = listOf(old)
  const after = listOf(next)
  if (before === undefined || after === undefined) return null
  const [column, ...inner] = path.split('.')
  const match = termMatchOf(context.table, column, inner.length > 0 ? inner : undefined)
  if (match === undefined) return null
  return listParts(before, after, match, (term) => quoted(cutTerm(term)))
}

const countText = (count: number | null | undefined) => (count == null ? none() : String(count))

// A key's null in the old partial is a key absent before; a null partial is a record absent before.
function recordChange({ old, new: next }: At): Change {
  const after = next ?? {}
  if (!isJsonObject(after)) return null
  let before: Readonly<Record<string, unknown>> | null
  if (old == null) before = null
  else if (isJsonObject(old)) before = old
  else return null
  const parts: string[] = []
  for (const key of Object.keys(before ?? after)) {
    const was = before !== null && Object.hasOwn(before, key) ? before[key] : null
    const now = Object.hasOwn(after, key) ? after[key] : null
    if (!isNullableNumber(was) || !isNullableNumber(now)) return null
    if ((was ?? null) === (now ?? null)) continue
    parts.push(
      fill('history:prose.quantity', {
        name: key,
        change: changed(countText(was), countText(now)),
      }),
    )
  }
  return parts.length === 0 ? SAME : parts.join(t('history:prose.listSeparator'))
}

// The working set holds the branch's every entity: a ref it lacks is gone, so it reads (deleted).
function refName(id: string, entry: DiffCacheEntry, context: ProseContext): string {
  const live = context.liveName(id)
  if (live !== null) return live
  if (!Object.hasOwn(entry.names, id)) return t('history:unknownTarget')
  return fill('history:prose.deletedName', { name: entry.names[id] })
}

function refText(id: string | null | undefined, entry: DiffCacheEntry, context: ProseContext) {
  return id == null || id === '' ? none() : refName(id, entry, context)
}

function entryText(id: string | null | undefined, context: ProseContext): string {
  if (id == null || id === '') return none()
  return context.entryLabel(id) ?? t('history:unknownEntry')
}

function rowRefChange({ old, new: next, entry }: At, context: ProseContext): Change {
  if (!isNullableString(old) || !isNullableString(next)) return null
  if (sameScalar(old, next)) return SAME
  return changed(refText(old, entry, context), refText(next, entry, context))
}

function refListChange({ old, new: next, entry }: At, context: ProseContext): Change {
  const before = listOf(old)
  const after = listOf(next)
  if (before === undefined || after === undefined) return null
  return listParts(before, after, 'exact', (id) => refName(id, entry, context))
}

function entryRefChange({ old, new: next }: At, context: ProseContext): Change {
  if (!isNullableString(old) || !isNullableString(next)) return null
  if (sameScalar(old, next)) return SAME
  return changed(entryText(old, context), entryText(next, context))
}

type Seen = { readonly entryId: string; readonly locationId: string | null }

function seenOf(value: unknown): Seen | null | undefined {
  if (value == null) return null
  if (!isJsonObject(value)) return undefined
  const { entryId, locationId } = value
  if (typeof entryId !== 'string' || !isNullableString(locationId)) return undefined
  return { entryId, locationId: locationId == null || locationId === '' ? null : locationId }
}

const sameSeen = (a: Seen | null, b: Seen | null) =>
  a === null || b === null ? a === b : a.entryId === b.entryId && a.locationId === b.locationId

function seenText(seen: Seen | null, entry: DiffCacheEntry, context: ProseContext): string {
  if (seen === null) return none()
  const at = entryText(seen.entryId, context)
  if (seen.locationId === null) return fill('history:prose.lastSeenNoPlace', { entry: at })
  return fill('history:prose.lastSeen', {
    entry: at,
    place: refName(seen.locationId, entry, context),
  })
}

// World time neither shows nor compares; a partial old takes the keys it lacks from new.
function lastSeenChange({ old, new: next, entry }: At, context: ProseContext): Change {
  const before = seenOf(isJsonObject(old) && isJsonObject(next) ? { ...next, ...old } : old)
  const after = seenOf(next)
  if (before === undefined || after === undefined) return null
  if (sameSeen(before, after)) return SAME
  return changed(seenText(before, entry, context), seenText(after, entry, context))
}

const PARENT = 'parent_location_id'
const UNPLACED = 'unplaced'
const COLLISION_FLAG = 'nameCollisionFlag'
const COLLISION_PARTNER = 'nameCollisionPartnerId'

function stateOf(values: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const state = values.state
  return isJsonObject(state) ? state : {}
}

// A column group's old side takes the members its payload lacks from the new side.
const memberOf = (
  old: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
  key: string,
): unknown => (Object.hasOwn(old, key) ? old[key] : next[key])

type Placement =
  | { readonly kind: 'under'; readonly id: string }
  | { readonly kind: 'top' | 'unplaced' }

function placementOf(parent: unknown, unplaced: unknown): Placement | undefined {
  if (!isNullableString(parent)) return undefined
  if (parent != null && parent !== '') return { kind: 'under', id: parent }
  return { kind: unplaced === true ? 'unplaced' : 'top' }
}

const placementKey = (placement: Placement) =>
  placement.kind === 'under' ? `under:${placement.id}` : placement.kind

// The parent picker's words for a place with no parent.
function placementText(placement: Placement, entry: DiffCacheEntry, context: ProseContext) {
  if (placement.kind === 'under') return refName(placement.id, entry, context)
  return placement.kind === 'top'
    ? t('world:connections.placementTopLevel')
    : t('world:connections.placementUnknown')
}

function placementChange({ entry }: At, context: ProseContext): Change {
  const oldState = stateOf(entry.old)
  const newState = stateOf(entry.new)
  const before = placementOf(
    memberOf(oldState, newState, PARENT),
    memberOf(oldState, newState, UNPLACED),
  )
  const after = placementOf(newState[PARENT], newState[UNPLACED])
  if (before === undefined || after === undefined) return null
  if (placementKey(before) === placementKey(after)) return SAME
  return changed(placementText(before, entry, context), placementText(after, entry, context))
}

// The flag reads its partner while raised; the reason never shows.
function collisionPartner(flag: unknown, partner: unknown): string | null | undefined {
  const raised = flagOf(flag)
  if (raised === undefined || !isNullableString(partner)) return undefined
  return raised === true && partner != null && partner !== '' ? partner : null
}

function collisionChange({ entry }: At, context: ProseContext): Change {
  const { old, new: next } = entry
  const before = collisionPartner(
    memberOf(old, next, COLLISION_FLAG),
    memberOf(old, next, COLLISION_PARTNER),
  )
  const after = collisionPartner(next[COLLISION_FLAG], next[COLLISION_PARTNER])
  if (before === undefined || after === undefined) return null
  if (before === after) return SAME
  return changed(refText(before, entry, context), refText(after, entry, context))
}

function changeOf(kind: ProseFieldKind, at: At, context: ProseContext): Change {
  switch (kind) {
    case 'text':
      return textChange(at)
    case 'enum':
      return enumChange(at, context)
    case 'number':
      return numberChange(at)
    case 'flag':
      return flagChange(at)
    case 'termList':
      return termListChange(at, context)
    case 'record':
      return recordChange(at)
    case 'rowRef':
      return rowRefChange(at, context)
    case 'refList':
      return refListChange(at, context)
    case 'entryRef':
      return entryRefChange(at, context)
    case 'lastSeen':
      return lastSeenChange(at, context)
    case 'placement':
      return placementChange(at, context)
    case 'collision':
      return collisionChange(at, context)
  }
}

/** world.md → Change prose for one update; null when no clause renders or a path has no wording. */
export function diffProse(entry: DiffCacheEntry, context: ProseContext): string | null {
  const clauses: string[] = []
  const groupsDone = new Set<ProseFieldKind>()
  for (const path of diffPaths(entry)) {
    const kind = proseFieldOf(context.table, path)
    if (kind === undefined) return null
    if (GROUP_KINDS.has(kind)) {
      if (groupsDone.has(kind)) continue
      groupsDone.add(kind)
    }
    const at: At = { path, old: valueAt(entry.old, path), new: valueAt(entry.new, path), entry }
    const change = changeOf(kind, at, context)
    if (change === null) return null
    if (change !== SAME)
      clauses.push(fill('history:prose.clause', { field: labelOf(path, context), change }))
  }
  return clauses.length === 0 ? null : clauses.join(t('history:prose.separator'))
}
