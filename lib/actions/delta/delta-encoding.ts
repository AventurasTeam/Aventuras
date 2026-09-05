import type { ZodType } from 'zod'

// Generic delta encoder. Walks a Zod schema in parallel with values to encode
// (diff) and decode (apply) op=update undo payloads per
// docs/data-model.md → Entry mutability & rollback. The schema is required at
// runtime because the null-sentinel meaning is node-type-dependent and TS types
// are erased.

type Node = {
  kind: 'object' | 'record' | 'array' | 'leaf'
  isOptional: boolean
  isNullable: boolean
  shape?: Record<string, ZodType>
  valueType?: ZodType
}

// Unwrap optional/nullable wrappers, recording the flags. Hard schema invariant
// (data-model): a leaf never stacks optional over nullable, so order is unambiguous.
function classify(schema: ZodType): Node {
  let isOptional = false
  let isNullable = false
  let s = schema
  // zod@4 introspection: schema.def.type, .def.innerType for optional/nullable.
  let def = (s as any).def
  while (def?.type === 'optional' || def?.type === 'nullable') {
    if (def.type === 'optional') isOptional = true
    if (def.type === 'nullable') isNullable = true
    s = def.innerType
    def = (s as any).def
  }
  if (def?.type === 'object') return { kind: 'object', isOptional, isNullable, shape: def.shape }
  if (def?.type === 'record')
    return { kind: 'record', isOptional, isNullable, valueType: def.valueType }
  if (def?.type === 'array') return { kind: 'array', isOptional, isNullable }
  return { kind: 'leaf', isOptional, isNullable }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  const ak = Object.keys(a as object)
  const bk = Object.keys(b as object)
  if (ak.length !== bk.length) return false
  return ak.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}

const ABSENT = Symbol('absent')
const NOCHANGE = Symbol('nochange')

/**
 * Reserved key prefix for payload metadata: facts the reversal needs that are not a
 * prior column value. Reverse-replay skips these keys instead of writing them, so a
 * `$`-prefixed key can never collide with a column (drizzle column keys are
 * identifiers) and can never reach a `SET` clause.
 */
export const PAYLOAD_META_PREFIX = '$'

export function isPayloadMetaKey(key: string): boolean {
  return key.startsWith(PAYLOAD_META_PREFIX)
}

// FORWARD: produce the nested-partial of changed paths carrying pre-change values.
export function computeUndoPayload(
  schema: ZodType,
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const node = classify(schema)
  const shape = node.shape
  if (!shape) throw new Error('computeUndoPayload: top-level schema must be a z.object')
  const undo: Record<string, unknown> = {}
  for (const key of Object.keys(shape)) {
    const cur = key in current ? current[key] : ABSENT
    const nxt = key in next ? next[key] : ABSENT
    const encoded = encodeField(shape[key], cur, nxt)
    if (encoded !== NOCHANGE) undo[key] = encoded
  }
  return undo
}

function encodeField(schema: ZodType, cur: unknown, nxt: unknown): unknown {
  const node = classify(schema)

  // absence transitions (optional leaves / keys)
  if (cur === ABSENT && nxt === ABSENT) return NOCHANGE
  if (cur === ABSENT) return null // was absent, now present -> sentinel: delete on undo
  if (nxt === ABSENT) return cur === undefined ? null : cur // restore pre-value

  // nullable transitions
  if (cur === null && nxt === null) return NOCHANGE
  if (cur === null) return null // null -> non-null : restore null
  if (nxt === null) return cur // non-null -> null : restore full pre-state

  if (node.kind === 'record') {
    const c = (cur ?? {}) as Record<string, unknown>
    const n = (nxt ?? {}) as Record<string, unknown>
    const sub: Record<string, unknown> = {}
    for (const k of new Set([...Object.keys(c), ...Object.keys(n)])) {
      if (!(k in c) && k in n)
        sub[k] = null // added -> delete on undo
      else if (k in c && !deepEqual(c[k], n[k])) sub[k] = c[k] // changed/removed -> restore
    }
    return Object.keys(sub).length ? sub : NOCHANGE
  }

  if (node.kind === 'object') {
    const partial = computeUndoPayload(
      schema,
      cur as Record<string, unknown>,
      nxt as Record<string, unknown>,
    )
    return Object.keys(partial).length ? partial : NOCHANGE
  }

  // leaf / array: whole-value replace
  return deepEqual(cur, nxt) ? NOCHANGE : cur
}

// REVERSE: overlay the pre-change partial onto the current value.
export function applyUndoPayload(
  schema: ZodType,
  current: Record<string, unknown>,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const node = classify(schema)
  const shape = node.shape
  if (!shape) throw new Error('applyUndoPayload: top-level schema must be a z.object')
  const out: Record<string, unknown> = { ...current }
  for (const key of Object.keys(payload)) {
    decodeField(shape[key], out, key, payload[key])
  }
  return out
}

function decodeField(
  schema: ZodType,
  out: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const node = classify(schema)

  if (value === null) {
    // sentinel meaning is node-type-dependent
    if (node.isOptional) {
      delete out[key] // optional leaf: key was absent pre-change
      return
    }
    out[key] = null // nullable leaf/object: restore null
    return
  }

  if (node.kind === 'record') {
    const base = { ...((out[key] as Record<string, unknown>) ?? {}) }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) delete base[k]
      else base[k] = v
    }
    out[key] = base
    return
  }

  if (node.kind === 'object') {
    const cur = (out[key] as Record<string, unknown>) ?? {}
    out[key] = applyUndoPayload(schema, cur, value as Record<string, unknown>)
    return
  }

  out[key] = value // leaf / array
}
