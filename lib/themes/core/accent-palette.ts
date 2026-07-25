export const CURATED_ACCENT_PALETTE = {
  red: '#dc2626',
  orange: '#ea580c',
  green: '#16a34a',
  teal: '#0d9488',
  blue: '#2563eb',
  indigo: '#4f46e5',
  pink: '#db2777',
} as const

export type CuratedAccentSlot = keyof typeof CURATED_ACCENT_PALETTE

export const CURATED_ACCENT_SLOTS = Object.keys(CURATED_ACCENT_PALETTE) as CuratedAccentSlot[]

export const NEUTRAL_ACCENT = '#71717a'

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function isCuratedSlot(value: string): value is CuratedAccentSlot {
  return value in CURATED_ACCENT_PALETTE
}

export function resolveAccentColor(value: string | null | undefined): string {
  if (value == null) return NEUTRAL_ACCENT
  if (isCuratedSlot(value)) return CURATED_ACCENT_PALETTE[value]
  return HEX.test(value) ? value : NEUTRAL_ACCENT
}

export function slotForHex(hex: string): CuratedAccentSlot | undefined {
  const lower = hex.toLowerCase()
  return CURATED_ACCENT_SLOTS.find((slot) => CURATED_ACCENT_PALETTE[slot] === lower)
}
