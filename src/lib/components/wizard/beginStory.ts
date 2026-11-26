export interface BeginStoryState {
  title: string
  /** Which opening will be used, and so which Starting Time field is meant; null when none. */
  opening: 'generated' | 'written' | 'imported' | null
  /** Whether the start beside that opening reads as a time; a blank one takes the default. */
  startIsValid: boolean
  busy: 'generating' | 'refining' | 'editing' | null
}

/** Why Begin Story is disabled, in the order the reader should fix it; null when it is not. */
export function beginStoryBlocker(state: BeginStoryState): string | null {
  if (!state.title.trim()) return 'Enter a story title.'
  switch (state.busy) {
    case 'generating':
      return 'Wait for the opening to finish generating.'
    case 'refining':
      return 'Wait for the opening to finish refining.'
    case 'editing':
      return 'Save or cancel your edit to the opening.'
    case null:
      break
    default: {
      const exhaustive: never = state.busy
      return exhaustive
    }
  }
  if (!state.opening) return 'Write an opening or generate one.'
  const where = FIELD[state.opening]
  if (!state.startIsValid) return `The Starting Time ${where} is not a time, e.g. Y1 D1 19:00.`
  return null
}

const FIELD = {
  generated: 'under the opening',
  written: 'under your opening',
  imported: 'under the imported opening',
} satisfies Record<NonNullable<BeginStoryState['opening']>, string>
