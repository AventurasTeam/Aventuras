// The tuple is the source of truth, not Object.keys of the palette: it needs no
// cast, it is readonly (the array backs the validity predicate below, so a
// mutable export would let any importer redefine what counts as curated), and
// it is the form z.enum will want once the write path is validated.
export const CURATED_ACCENT_SLOTS = [
  'red',
  'orange',
  'green',
  'teal',
  'blue',
  'indigo',
  'pink',
] as const

export type CuratedAccentSlot = (typeof CURATED_ACCENT_SLOTS)[number]

// Branded so a raw stored colour cannot reach a consumer that needs a resolved
// one. `tintOf` parses hex digits: handed 'chartreuse' it yields
// rgba(NaN, NaN, NaN, α) and renders nothing, with no error anywhere. Only
// resolveAccentColor mints this, so that call becomes unskippable.
export type AccentHex = string & { readonly __accentHex: unique symbol }

const accentHex = (value: string) => value as AccentHex

export const CURATED_ACCENT_PALETTE: Record<CuratedAccentSlot, AccentHex> = {
  red: accentHex('#dc2626'),
  orange: accentHex('#ea580c'),
  green: accentHex('#16a34a'),
  teal: accentHex('#0d9488'),
  blue: accentHex('#2563eb'),
  indigo: accentHex('#4f46e5'),
  pink: accentHex('#db2777'),
}

export const NEUTRAL_ACCENT = accentHex('#71717a')

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function isCuratedSlot(value: string): value is CuratedAccentSlot {
  // Membership via the slot tuple, not `value in CURATED_ACCENT_PALETTE`: `in`
  // walks the prototype chain, so a stored color of 'constructor' or 'toString'
  // would resolve to a function out of a String-returning fallback.
  return (CURATED_ACCENT_SLOTS as readonly string[]).includes(value)
}

// Deliberately permissive on the read path: category rows predate any write
// validation and can be orphaned, so every input must render as something. The
// write path is where a bad colour should be rejected.
export function resolveAccentColor(value: string | null | undefined): AccentHex {
  if (value == null) return NEUTRAL_ACCENT
  if (isCuratedSlot(value)) return CURATED_ACCENT_PALETTE[value]
  return HEX.test(value) ? accentHex(value) : NEUTRAL_ACCENT
}

// Matches the palette's canonical 6-digit lowercase form only; a 3-digit
// equivalent of a palette value returns undefined and is treated as custom.
export function slotForHex(hex: string): CuratedAccentSlot | undefined {
  const lower = hex.toLowerCase()
  return CURATED_ACCENT_SLOTS.find((slot) => CURATED_ACCENT_PALETTE[slot] === lower)
}
