import type { IdBiMap } from '@/lib/ids'

// The reference fields a new row's handle can stand in; `happening` and `thread` name listed rows.
const HANDLE_FIELDS = ['ref', 'subject', 'object', 'parent', 'character', 'faction'] as const

/** Schema fields whose string value is an entity reference. Must stay in sync
 * with the planner's ref consumers. */
export const PLACEHOLDER_FIELDS = [...HANDLE_FIELDS, 'happening', 'thread'] as const

/**
 * Namespace the prompt reserves for `newCharacters`, `newFactions` and `newPlaces` handles, so a
 * handle can never be mistaken for an entity placeholder (`c1`, `hp1`, ...).
 */
export const NEW_HANDLE_PREFIX = 'new:'

/** The ID inside the brackets the prompt shows it in, for a reply that copied them: "[c1]" is c1. */
export const unbracketed = (value: string): string | undefined => /^\[([^[\]]+)\]$/.exec(value)?.[1]

/**
 * Placeholder -> UUID, the return trip of `substituteIds`; unknown strings pass through for the
 * planner's handleMap. `reservedHandles` are never rewritten where a handle can stand: a model
 * ignoring NEW_HANDLE_PREFIX and naming a new character `c1` has its refs sent to entity `c1`.
 */
export function substituteClassifierIds<T>(
  value: T,
  idMap: IdBiMap,
  reservedHandles: ReadonlySet<string> = new Set(),
): T {
  if (Array.isArray(value))
    return value.map((v) => substituteClassifierIds(v, idMap, reservedHandles)) as T
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => {
      if (typeof v === 'string' && (PLACEHOLDER_FIELDS as readonly string[]).includes(key)) {
        const handleField = (HANDLE_FIELDS as readonly string[]).includes(key)
        const known = (ref: string): boolean =>
          (handleField && reservedHandles.has(ref)) || idMap.getUuidFor(ref) != null
        const bare = unbracketed(v)
        const ref = bare != null && !known(v) && known(bare) ? bare : v
        const reserved = handleField && reservedHandles.has(ref)
        return [key, reserved ? ref : (idMap.getUuidFor(ref) ?? ref)]
      }
      return [key, substituteClassifierIds(v, idMap, reservedHandles)]
    }),
  ) as T
}

/** Fields the model writes prose into, where an ID or a handle is a slip; every other string field
 *  is a reference, a handle, a turn or an enum value. */
export const PROSE_FIELDS = [
  'attire',
  'category',
  'condition',
  'description',
  'distinguishing',
  'eyes',
  'face',
  'hair',
  'kind',
  'name',
  'physique',
  'reason',
  'role',
  'source',
  'standing',
  'temporal',
  'title',
  'voice',
  'traits',
  'drives',
  'agenda',
] as const

// A bracketed token, a bare short-prefix placeholder, or a bare handle; `nameOf` decides which name.
const PROSE_TOKEN = /\[([^[\]\s]+)\]|\b[a-z]{1,2}\d+\b|\bnew:[\w-]+/g

/**
 * An ID or a handle the model wrote into prose, as the name `nameOf` gives it: a placeholder means
 * nothing past this call, so a stored "[c1] charged" would name whoever holds c1 in a later prompt.
 * A token `nameOf` doesn't name stays as written.
 */
export function nameIdsInProse<T>(value: T, nameOf: (token: string) => string | undefined): T {
  const walk = (v: unknown, prose: boolean): unknown => {
    if (typeof v === 'string')
      return prose
        ? v.replace(PROSE_TOKEN, (token, inner?: string) => nameOf(inner ?? token) ?? token)
        : v
    if (Array.isArray(v)) return v.map((item) => walk(item, prose))
    if (v === null || typeof v !== 'object') return v
    return Object.fromEntries(
      Object.entries(v).map(([key, field]) => [
        key,
        walk(field, (PROSE_FIELDS as readonly string[]).includes(key)),
      ]),
    )
  }
  return walk(value, false) as T
}

/** The name each listed row's placeholder and each of the reply's handles stands for. */
export function idNames(
  idMap: IdBiMap,
  rows: {
    entities: readonly { id: string; name: string }[]
    happenings: readonly { id: string; title: string }[]
    threads: readonly { id: string; title: string }[]
  },
  reply: {
    newCharacters: readonly { handle: string; name: string }[]
    newFactions: readonly { handle: string; name: string }[]
    newPlaces?: readonly { handle: string; name: string }[]
  },
): (token: string) => string | undefined {
  const byId = new Map<string, string>([
    ...rows.entities.map((e) => [e.id, e.name] as const),
    ...rows.happenings.map((h) => [h.id, h.title] as const),
    ...rows.threads.map((t) => [t.id, t.title] as const),
  ])
  // A handle declared twice is named as its first declaration binds it.
  const byHandle = new Map<string, string>()
  for (const { handle, name } of [
    ...reply.newCharacters,
    ...reply.newFactions,
    ...(reply.newPlaces ?? []),
  ])
    if (!byHandle.has(handle) && name.trim() !== '') byHandle.set(handle, name.trim())
  return (token) => {
    const id = idMap.getUuidFor(token)
    return id == null ? byHandle.get(token) : byId.get(id)
  }
}
