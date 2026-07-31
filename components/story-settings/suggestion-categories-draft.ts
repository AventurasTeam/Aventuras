import type { SuggestionCategory as DraftCategory } from '@/components/compounds/suggestion-categories-editor'
import type { SuggestionCategory as StoredCategory } from '@/lib/db'
import {
  CURATED_ACCENT_PALETTE,
  CURATED_ACCENT_SLOTS,
  slotForHex,
  type CuratedAccentSlot,
} from '@/lib/themes'

/** The swatches the per-row ColorPicker offers — the fixed, mode-agnostic set. */
export const SUGGESTION_SWATCHES: string[] = CURATED_ACCENT_SLOTS.map(
  (slot) => CURATED_ACCENT_PALETTE[slot],
)

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function isCuratedSlot(value: string): value is CuratedAccentSlot {
  return (CURATED_ACCENT_SLOTS as readonly string[]).includes(value)
}

// Not resolveAccentColor: that collapses "unset" and "unresolvable" into
// NEUTRAL_ACCENT, and the editor needs null to render its fallback swatch —
// otherwise every colourless row comes back looking deliberately grey.
function storedColorToHex(color: string): string | null {
  if (isCuratedSlot(color)) return CURATED_ACCENT_PALETTE[color]
  return HEX.test(color) ? color : null
}

/** Stored rows → the editor's shape. `order` becomes array position. */
export function toDraft(stored: readonly StoredCategory[]): DraftCategory[] {
  return [...stored]
    .sort((a, b) => a.order - b.order)
    .map((row) => ({
      id: row.id,
      label: row.label,
      color: storedColorToHex(row.color),
      promptHint: row.promptHint,
      enabled: row.enabled,
    }))
}

/** The editor's shape → stored rows. Array position becomes `order`. */
export function toStored(draft: readonly DraftCategory[]): StoredCategory[] {
  return draft.map((row, index) => ({
    id: row.id,
    label: row.label,
    promptHint: row.promptHint,
    // A curated pick persists as its slot key so a palette revision reaches
    // existing stories; a custom pick persists raw. Both resolve on read.
    color: row.color == null ? '' : (slotForHex(row.color) ?? row.color),
    enabled: row.enabled,
    order: index,
  }))
}

export type DraftValidity = { ok: true } | { ok: false; problem: 'empty-label' | 'duplicate-label' }

export function validateDraft(draft: readonly DraftCategory[]): DraftValidity {
  const seen = new Set<string>()
  for (const row of draft) {
    const key = row.label.trim().toLowerCase()
    if (key.length === 0) return { ok: false, problem: 'empty-label' }
    if (seen.has(key)) return { ok: false, problem: 'duplicate-label' }
    seen.add(key)
  }
  return { ok: true }
}

/**
 * Field-wise, not `JSON.stringify`: both sides are built by different code
 * paths (one by Zod's parse, one by `toStored`) and key order is not a contract
 * either of them keeps.
 */
export function sameStoredCategories(
  a: readonly StoredCategory[],
  b: readonly StoredCategory[],
): boolean {
  if (a.length !== b.length) return false
  return a.every((row, index) => {
    const other = b[index]
    return (
      other != null &&
      row.id === other.id &&
      row.label === other.label &&
      row.promptHint === other.promptHint &&
      row.color === other.color &&
      row.enabled === other.enabled &&
      row.order === other.order
    )
  })
}
