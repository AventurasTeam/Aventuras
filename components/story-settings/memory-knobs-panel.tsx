import { useState, type ReactNode } from 'react'
import { View } from 'react-native'

import type { StorySettings } from '@/lib/db'
import { t } from '@/lib/i18n'

import {
  ChapterCloseSection,
  ClassifierCadenceSection,
  KeywordRetrievalSection,
  PromptContextSection,
  RetrievalBudgetsSection,
} from './memory-knob-sections'
import {
  memoryKnobsDirtyKeys,
  toMemoryKnobsDraft,
  toMemoryKnobsPatch,
  validateMemoryKnobs,
} from './memory-knobs'
import { useStorySettingsSection } from './save-session'

type MemoryKnobsPanelProps = {
  settings: StorySettings
  disabled?: boolean
  disabledReason?: string
  /** Rendered between Classifier and Retrieval budgets, where canon places the Embedder section. */
  embedder?: ReactNode
}

/**
 * ONE section over one draft: Classifier's overlap indicator and Prompt context's full-chapter
 * hint read other groups' unsaved values. The embedder slot stays outside the save session.
 */
export function MemoryKnobsPanel({
  settings,
  disabled = false,
  disabledReason,
  embedder,
}: MemoryKnobsPanelProps) {
  const [draft, setDraft] = useState(() => toMemoryKnobsDraft(settings))
  const dirtyKeys = memoryKnobsDirtyKeys(draft, settings)
  const problem = validateMemoryKnobs(draft)

  useStorySettingsSection({
    id: 'memory-knobs',
    tab: 'memory',
    dirtyFields: dirtyKeys.map((key) => t(`storySettings:memory.knobs.field.${key}`)),
    invalidReason: problem != null ? t(`storySettings:memory.knobs.invalid.${problem}`) : undefined,
    // The whole draft, never a diff vs `settings`: it is re-read after the store refresh.
    getPatch: () => toMemoryKnobsPatch(draft),
    reset: () => setDraft(toMemoryKnobsDraft(settings)),
  })

  const sectionProps = {
    draft,
    // Derived from the live prop, so a revert after a save lands on the saved value.
    baseline: toMemoryKnobsDraft(settings),
    onChange: setDraft,
    problem,
    disabled,
    disabledReason,
  }
  return (
    <View testID="memory-knobs-panel" className="gap-6">
      <ChapterCloseSection {...sectionProps} />
      <PromptContextSection {...sectionProps} />
      <ClassifierCadenceSection {...sectionProps} />
      {embedder}
      <RetrievalBudgetsSection {...sectionProps} />
      <KeywordRetrievalSection {...sectionProps} />
    </View>
  )
}

export type { MemoryKnobsPanelProps }
