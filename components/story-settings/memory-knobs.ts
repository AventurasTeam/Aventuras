import { worstCaseCadenceEntries } from '@/lib/classifier'
import type { StorySettings } from '@/lib/db'

type Budgets = StorySettings['retrievalBudgets']
type Keyword = StorySettings['keywordRetrieval']

export type BudgetKey = keyof Budgets

export type MemoryKnobsDraft = {
  chapterTokenThreshold: number | null
  chapterAutoClose: boolean
  fullChapterInBuffer: boolean
  partialChapterBuffer: number | null
  protectedBuffer: number | null
  classifierContextEntries: number
  classifierCadence: number | null
  retrievalBudgets: Record<BudgetKey, number | null>
  keywordRetrieval: {
    mode: Keyword['mode']
    budgetShare: number | null
    scanEntries: number | null
    cascade: boolean
    cascadeMaxDepth: number | null
  }
}

export type MemoryKnobsKey = keyof MemoryKnobsDraft

export type MemoryKnobsPatch = Pick<StorySettings, MemoryKnobsKey>

// Records rather than plain arrays: both key sets are derived from a type declared
// elsewhere, so a bare array is an unchecked subset. A knob missing from the order
// below never reports dirty, so the section would silently never save it.
const MEMORY_KNOBS_ORDER = {
  chapterTokenThreshold: true,
  chapterAutoClose: true,
  fullChapterInBuffer: true,
  partialChapterBuffer: true,
  protectedBuffer: true,
  classifierContextEntries: true,
  classifierCadence: true,
  retrievalBudgets: true,
  keywordRetrieval: true,
} satisfies Record<MemoryKnobsKey, true>

const BUDGET_ORDER = {
  entities: true,
  lore: true,
  happenings: true,
  threads: true,
  chapters: true,
} satisfies Record<BudgetKey, true>

/** Tab order — drives the save bar's label order within the section. */
export const MEMORY_KNOBS_KEYS: readonly MemoryKnobsKey[] = Object.keys(
  MEMORY_KNOBS_ORDER,
) as MemoryKnobsKey[]

export const BUDGET_KEYS: readonly BudgetKey[] = Object.keys(BUDGET_ORDER) as BudgetKey[]

export const CHAPTER_THRESHOLD_PRESETS = [
  { id: 'short', tokens: 8000 },
  { id: 'balanced', tokens: 24000 },
  { id: 'long', tokens: 48000 },
] as const

export type ThresholdPreset = (typeof CHAPTER_THRESHOLD_PRESETS)[number]['id'] | 'custom'

/** cadence.md → User-tunable knobs: the fixed action-plus-reply pair the classifier reads. */
export const CLASSIFIER_CONTEXT_MIN = 2
/** A UI ceiling only; the schema has none. Wider than any sane fallback window. */
export const CLASSIFIER_CONTEXT_MAX = 20

export type MemoryKnobsProblem =
  | 'threshold'
  | 'partialBuffer'
  | 'protectedBuffer'
  | 'cadence'
  | 'budget'
  | 'budgetShare'
  | 'scanEntries'
  | 'cascadeDepth'

export function toMemoryKnobsDraft(settings: StorySettings): MemoryKnobsDraft {
  return {
    chapterTokenThreshold: settings.chapterTokenThreshold,
    chapterAutoClose: settings.chapterAutoClose,
    fullChapterInBuffer: settings.fullChapterInBuffer,
    partialChapterBuffer: settings.partialChapterBuffer,
    protectedBuffer: settings.protectedBuffer,
    classifierContextEntries: settings.classifierContextEntries,
    classifierCadence: settings.classifierCadence,
    retrievalBudgets: { ...settings.retrievalBudgets },
    keywordRetrieval: { ...settings.keywordRetrieval },
  }
}

function isCount(value: number | null, min: number): value is number {
  return value != null && Number.isInteger(value) && value >= min
}

// NaN and infinities fail these bounds on their own, so there is no finiteness check.
function isBudgetShare(value: number | null): value is number {
  return value != null && value >= 0 && value <= 1
}

/** Each knob's rule, keyed by the problem it reports; `budget` holds for every budget. */
export const KNOB_RULES = {
  threshold: (value: number | null) => isCount(value, 1),
  partialBuffer: (value: number | null) => isCount(value, 0),
  protectedBuffer: (value: number | null) => isCount(value, 0),
  cadence: (value: number | null) => isCount(value, 1),
  budget: (value: number | null) => isCount(value, 0),
  budgetShare: isBudgetShare,
  scanEntries: (value: number | null) => isCount(value, 1),
  cascadeDepth: (value: number | null) => isCount(value, 1),
} satisfies Record<MemoryKnobsProblem, (value: number | null) => boolean>

export function validateMemoryKnobs(draft: MemoryKnobsDraft): MemoryKnobsProblem | null {
  const keyword = draft.keywordRetrieval
  if (!KNOB_RULES.threshold(draft.chapterTokenThreshold)) return 'threshold'
  if (!KNOB_RULES.partialBuffer(draft.partialChapterBuffer)) return 'partialBuffer'
  if (!KNOB_RULES.protectedBuffer(draft.protectedBuffer)) return 'protectedBuffer'
  if (!KNOB_RULES.cadence(draft.classifierCadence)) return 'cadence'
  if (BUDGET_KEYS.some((key) => !KNOB_RULES.budget(draft.retrievalBudgets[key]))) return 'budget'
  if (!KNOB_RULES.budgetShare(keyword.budgetShare)) return 'budgetShare'
  if (!KNOB_RULES.scanEntries(keyword.scanEntries)) return 'scanEntries'
  if (!KNOB_RULES.cascadeDepth(keyword.cascadeMaxDepth)) return 'cascadeDepth'
  return null
}

/** @throws when the draft is invalid — the provider never calls getPatch on an invalid section. */
export function toMemoryKnobsPatch(draft: MemoryKnobsDraft): MemoryKnobsPatch {
  const problem = validateMemoryKnobs(draft)
  if (problem != null) throw new Error(`memory knobs draft is invalid: ${problem}`)
  const budgets = Object.fromEntries(
    BUDGET_KEYS.map((key) => [key, draft.retrievalBudgets[key] as number]),
  ) as Budgets
  return {
    chapterTokenThreshold: draft.chapterTokenThreshold as number,
    chapterAutoClose: draft.chapterAutoClose,
    fullChapterInBuffer: draft.fullChapterInBuffer,
    partialChapterBuffer: draft.partialChapterBuffer as number,
    protectedBuffer: draft.protectedBuffer as number,
    classifierContextEntries: draft.classifierContextEntries,
    classifierCadence: draft.classifierCadence as number,
    retrievalBudgets: budgets,
    keywordRetrieval: {
      mode: draft.keywordRetrieval.mode,
      budgetShare: draft.keywordRetrieval.budgetShare as number,
      scanEntries: draft.keywordRetrieval.scanEntries as number,
      cascade: draft.keywordRetrieval.cascade,
      cascadeMaxDepth: draft.keywordRetrieval.cascadeMaxDepth as number,
    },
  }
}

function sameShallow(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => a[key] === b[key])
}

export function memoryKnobsDirtyKeys(
  draft: MemoryKnobsDraft,
  settings: StorySettings,
): MemoryKnobsKey[] {
  return MEMORY_KNOBS_KEYS.filter((key) => {
    if (key === 'retrievalBudgets')
      return !sameShallow(draft.retrievalBudgets, settings.retrievalBudgets)
    if (key === 'keywordRetrieval')
      return !sameShallow(draft.keywordRetrieval, settings.keywordRetrieval)
    return draft[key] !== settings[key]
  })
}

export function thresholdPreset(tokens: number | null): ThresholdPreset {
  return CHAPTER_THRESHOLD_PRESETS.find((preset) => preset.tokens === tokens)?.id ?? 'custom'
}

/** cadence.md → Buffer-aware cadence indicator; negative means entries leave the window unclassified. */
export function cadenceOverlap(
  partialChapterBuffer: number | null,
  classifierCadence: number | null,
): number | null {
  if (partialChapterBuffer == null || classifierCadence == null) return null
  return partialChapterBuffer - worstCaseCadenceEntries(classifierCadence)
}
