import type { SuggestionCategory } from '@/lib/db'

import type { SuggestionRef } from './types'

export type SuggestionSlot = { ref: string; label: string; promptHint: string }

export type SuggestionSlotMap = {
  slots: SuggestionSlot[]
  resolveCategoryId: (ref: string) => string | undefined
}

// Categories are not an LLM-facing kind in data-model.md's substitution table,
// so they get their own per-emission map rather than riding IdBiMap: a real
// category id in the prompt would leak a persisted handle the model could echo
// back verbatim and bypass validation.
export function buildSuggestionSlots(categories: readonly SuggestionCategory[]): SuggestionSlotMap {
  const enabled = categories.filter((c) => c.enabled).sort((a, b) => a.order - b.order)
  const byRef = new Map<string, string>()
  const slots = enabled.map((category, index) => {
    const ref = `cat${index + 1}`
    byRef.set(ref, category.id)
    const hint = category.promptHint.trim()
    return { ref, label: category.label, promptHint: hint.length > 0 ? hint : category.label }
  })
  return { slots, resolveCategoryId: (ref) => byRef.get(ref) }
}

export type SuggestionEmission = SuggestionSlotMap & {
  settingsAllowEmission: boolean
  count: number
}

// The SETTINGS-level half of the emission gate — the story wants chips and has
// something enabled to pick from (reader-composer.md → Zero enabled
// categories). Callers AND their own run-level condition on top: the narrative
// fold also requires the tagged block to be firing at all, and the classifier
// fold also requires that no chips were already captured this turn.
// `settingsAllowEmission` alone is never sufficient to emit.
export function resolveSuggestionEmission(settings: {
  suggestionsEnabled: boolean
  suggestionCount: number
  suggestionCategories: readonly SuggestionCategory[]
}): SuggestionEmission {
  const map = buildSuggestionSlots(settings.suggestionCategories)
  return {
    ...map,
    settingsAllowEmission: settings.suggestionsEnabled && map.slots.length > 0,
    count: settings.suggestionCount,
  }
}

// Chips only ever land on AI-authored entries, so those are the only kinds that
// can anchor the strip — and both exclusions are load-bearing, not tidiness.
// Skipping `system` keeps chips off a failure card `clearSystemEntry` deletes
// on Retry / Dismiss / next Send. Skipping `user_action` is what keeps the
// strip showing the previous reply's chips for the length of a turn, instead of
// blanking to the empty-state ⟳ Generate the moment the action commits —
// offering "generate suggestions" while the generation that produces them is
// already running (reader-composer.md → the per-turn lock: whatever the strip
// was showing just locks).
const ANCHOR_KINDS: ReadonlySet<string> = new Set(['ai_reply', 'opening'])

export function findSuggestionAnchor<T extends { kind: string }>(
  entries: readonly T[],
): T | undefined {
  return entries.findLast((e) => ANCHOR_KINDS.has(e.kind))
}

// The UI-level half of the strip's mount gate (reader-composer.md → Edge
// cases → Zero enabled categories). settingsAllowEmission alone would hide
// the strip whenever categories are all disabled, even on a terminal entry
// that already carries chips from before they were disabled — those must
// keep rendering (with orphan-label handling). Only the case with nothing to
// show AND nothing to generate should hide the strip; suggestionsEnabled:
// false is a hard hide regardless of historical chips (toggling it back off
// mid-story hides the strip even though the persisted data survives).
export function shouldShowSuggestionStrip(params: {
  suggestionsEnabled: boolean
  hasTerminalEntry: boolean
  hasChips: boolean
  categories: readonly SuggestionCategory[]
}): boolean {
  if (!params.suggestionsEnabled || !params.hasTerminalEntry) return false
  return params.hasChips || buildSuggestionSlots(params.categories).slots.length > 0
}

export type SuggestionItem = { categoryId: string; text: string }

// Generous by design: the prompt asks for one or two sentences, which runs
// 120-200 characters, so this only rejects a model that has stopped writing
// suggestions and started writing prose. A chip's text is inserted into the
// composer verbatim on tap, so truncating would hand the writer mangled input —
// dropping is the honest failure.
export const MAX_SUGGESTION_CHARS = 400

// Shared by both per-turn folds and suggestion-refresh: an unresolvable ref
// is dropped, not defaulted (a chip pointing at a category the prompt never
// showed has no label/color to render with), an over-long one is dropped
// because it would push the composer off screen, and the resolved list is
// clamped to the settings-driven count even on an over-emit
// (reader-composer.md: suggestionCount "drives literal chip count per
// emission"). droppedCount is measured pre-clamp — truncating a valid
// over-emit isn't a drop.
export function resolveSuggestionItems(
  raw: readonly SuggestionRef[],
  emission: SuggestionEmission,
): { items: SuggestionItem[]; droppedCount: number } {
  const resolved = raw.flatMap((item) => {
    const categoryId = emission.resolveCategoryId(item.categoryRef)
    if (categoryId === undefined || item.text.length > MAX_SUGGESTION_CHARS) return []
    return [{ categoryId, text: item.text }]
  })
  return { items: resolved.slice(0, emission.count), droppedCount: raw.length - resolved.length }
}
