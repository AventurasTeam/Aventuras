import { MalformedPlaceholderError, type IdBiMap } from '@/lib/ids'

import type { ParsedTransfers, ParseFieldFailure, ParsedStateBlock } from './types'

type SubstituteResult = { block: ParsedStateBlock; failures: ParseFieldFailure[] }

// The prompt displays each entity's placeholder in brackets ("[c1] Kael")
// for readability, but the emission grammar wants the bare placeholder back
// (docs/memory/piggyback.md → Trailing block format) — unwrap an optional
// bracket pair so a model that echoes the display form still resolves.
function unwrapBracket(ref: string): string {
  const match = /^\[(.+)\]$/.exec(ref)
  return match ? match[1] : ref
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

function resolveTransfers(transfers: ParsedTransfers, idMap: IdBiMap): ParsedTransfers {
  return {
    items: transfers.items.map((item) => ({
      ...item,
      id: resolveRef(item.id, idMap),
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

// Only the actual ID-bearing sub-fields are resolved (id/to/from, never
// type/text/slot/key/amount) — granularity matches parseStateBlock's: an
// unresolvable reference fails only the field it lives in, never a sibling
// field (docs/memory/piggyback.md → Parse strategy and failure recovery).
export function substitutePiggybackIds(block: ParsedStateBlock, idMap: IdBiMap): SubstituteResult {
  const result: ParsedStateBlock = { ...block }
  const failures: ParseFieldFailure[] = []

  resolveField(
    result,
    'sceneEntities',
    (ids, m) => ids.map((id) => resolveRef(id, m)),
    idMap,
    failures,
  )
  resolveField(result, 'currentLocation', (id, m) => resolveRef(id, m), idMap, failures)
  resolveField(
    result,
    'visualChanges',
    (notes, m) => notes.map((n) => ({ ...n, id: resolveRef(n.id, m) })),
    idMap,
    failures,
  )
  resolveField(result, 'transfers', resolveTransfers, idMap, failures)

  return { block: result, failures }
}
