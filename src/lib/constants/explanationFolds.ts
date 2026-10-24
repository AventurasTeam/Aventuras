/**
 * Every folding explanation in the app, as rendered by `shared/ExplanationFold`. An id is also
 * the name its fold state is saved under, so renaming one unfolds it for everyone once.
 */
export const EXPLANATION_FOLDS = ['checkpoint_help', 'entry_time_help', 'time_anchor_help'] as const

export type ExplanationFoldId = (typeof EXPLANATION_FOLDS)[number]

export function explanationFoldSetting(id: ExplanationFoldId): string {
  return `${id}_folded`
}
