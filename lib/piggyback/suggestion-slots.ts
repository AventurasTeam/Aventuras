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

export type SuggestionEmission = SuggestionSlotMap & { fires: boolean; count: number }

// The single gate both folds consult: the fragment is omitted from the prompt
// entirely unless the feature is on AND something is enabled to pick from
// (reader-composer.md → Zero enabled categories).
export function resolveSuggestionEmission(settings: {
  suggestionsEnabled: boolean
  suggestionCount: number
  suggestionCategories: readonly SuggestionCategory[]
}): SuggestionEmission {
  const map = buildSuggestionSlots(settings.suggestionCategories)
  return {
    ...map,
    fires: settings.suggestionsEnabled && map.slots.length > 0,
    count: settings.suggestionCount,
  }
}
