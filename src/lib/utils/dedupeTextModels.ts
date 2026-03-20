import type { TextModel } from '$lib/types'

export function dedupeTextModels(models: TextModel[]): TextModel[] {
  const deduped = new Map<string, TextModel>()

  for (const model of models) {
    const id = model.id.trim()
    if (!id) continue

    const existing = deduped.get(id)
    if (existing) {
      deduped.set(id, {
        ...existing,
        reasoning: existing.reasoning || model.reasoning || undefined,
        structuredOutput: existing.structuredOutput || model.structuredOutput || undefined,
      })
      continue
    }

    deduped.set(id, { ...model, id })
  }

  return Array.from(deduped.values())
}
