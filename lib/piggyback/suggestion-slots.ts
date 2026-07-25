import type { SuggestionCategory } from '@/lib/db'

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
