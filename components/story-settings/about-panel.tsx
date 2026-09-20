import { Star } from 'lucide-react-native'
import { useState } from 'react'
import { View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { SwitchRow } from '@/components/compounds/switch-row'
import { TagInput } from '@/components/compounds/tag-input'
import { MODE_DEFAULT_COLOR } from '@/components/story/story-card'
import { ColorPicker } from '@/components/ui/color-picker'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { isStoryMode, type StoryDefinition, type StoryInfo } from '@/lib/db'
import { t } from '@/lib/i18n'
import { NEUTRAL_ACCENT } from '@/lib/themes'

import {
  ACCENT_SWATCHES,
  aboutColumnPatch,
  aboutDirtyKeys,
  toAboutDraft,
  validateAbout,
  type AboutProblem,
} from './about-draft'
import { useStorySettingsSection } from './save-session'

const INVALID_KEY = {
  'draft-story': 'storySettings:about.invalid.draftStory',
  'empty-title': 'storySettings:about.invalid.emptyTitle',
  'invalid-accent': 'storySettings:about.invalid.accentColor',
} as const satisfies Record<AboutProblem, string>

type AboutPanelProps = {
  story: StoryInfo
  /** Only `mode` is read, for the accent fallback swatch. */
  definition: StoryDefinition | null
  disabled?: boolean
  disabledReason?: string
}

/** Story Settings → About: library-shaped identity columns. */
export function AboutPanel({
  story,
  definition,
  disabled = false,
  disabledReason,
}: AboutPanelProps) {
  // Diffed against this, not the live `story`: the provider re-reads the column
  // patch after the store refresh, where a live diff is empty and skips the reset.
  const [baseline, setBaseline] = useState(() => toAboutDraft(story))
  const [draft, setDraft] = useState(() => toAboutDraft(story))

  const dirtyKeys = aboutDirtyKeys(draft, baseline)
  const problem = validateAbout(draft, baseline)

  useStorySettingsSection({
    id: 'about',
    tab: 'about',
    dirtyFields: dirtyKeys.map((key) => t(`storySettings:about.field.${key}`)),
    invalidReason: problem != null ? t(INVALID_KEY[problem]) : undefined,
    getPatch: () => ({}),
    getColumnPatch: () => aboutColumnPatch(draft, baseline),
    reset: () => {
      setBaseline(toAboutDraft(story))
      setDraft(toAboutDraft(story))
    },
  })

  const rawMode = definition?.mode
  const fallbackAccent = isStoryMode(rawMode) ? MODE_DEFAULT_COLOR[rawMode] : NEUTRAL_ACCENT
  const isDraftStory = baseline.status === 'draft'
  const disabledHint = disabled ? disabledReason : undefined

  return (
    <View testID="about-panel" className="gap-4">
      <View className="gap-0.5">
        <Text className="font-semibold">{t('storySettings:about.heading')}</Text>
        <Text size="sm" variant="muted">
          {t('storySettings:about.intro')}
        </Text>
      </View>

      <FormRow
        label={t('storySettings:about.title')}
        required
        error={problem === 'empty-title' ? t('storySettings:about.invalid.emptyTitle') : undefined}
      >
        <Input
          testID="about-title"
          aria-label={t('storySettings:about.title')}
          value={draft.title}
          onChangeText={(title) => setDraft((prev) => ({ ...prev, title }))}
          editable={!disabled}
          accessibilityHint={disabledHint}
          aria-invalid={problem === 'empty-title'}
        />
      </FormRow>

      <FormRow
        label={t('storySettings:about.description')}
        hint={t('storySettings:about.descriptionHint')}
      >
        <Textarea
          testID="about-description"
          aria-label={t('storySettings:about.description')}
          value={draft.description}
          onChangeText={(description) => setDraft((prev) => ({ ...prev, description }))}
          editable={!disabled}
          accessibilityHint={disabledHint}
          rows={3}
        />
      </FormRow>

      <FormRow label={t('storySettings:about.tags')}>
        <TagInput
          value={draft.tags}
          onChange={(tags) => setDraft((prev) => ({ ...prev, tags }))}
          label={t('storySettings:about.tags')}
          placeholder={t('storySettings:about.tagsPlaceholder')}
          disabled={disabled}
          disabledReason={disabledReason}
        />
      </FormRow>

      <Text size="sm" variant="muted">
        {t('storySettings:about.appearance')}
      </Text>
      <FormRow label={t('storySettings:about.accentColor')}>
        <ColorPicker
          testID="about-accent"
          swatches={ACCENT_SWATCHES}
          value={draft.accentColor}
          onChange={(accentColor) => setDraft((prev) => ({ ...prev, accentColor }))}
          fallbackColor={fallbackAccent}
          fallbackLabel={t('storySettings:about.accentNone')}
          allowCustom
          disabled={disabled}
          disabledReason={disabledReason}
        />
      </FormRow>

      <Text size="sm" variant="muted">
        {t('storySettings:about.library')}
      </Text>
      <FormRow
        label={t('storySettings:about.status')}
        hint={isDraftStory ? t('storySettings:about.statusDraft') : undefined}
      >
        <Select
          mode="segment"
          label={t('storySettings:about.status')}
          options={[
            { value: 'active', label: t('storySettings:about.statusActive') },
            { value: 'archived', label: t('storySettings:about.statusArchived') },
          ]}
          value={draft.status}
          onValueChange={(value) =>
            setDraft((prev) => ({ ...prev, status: value === 'archived' ? 'archived' : 'active' }))
          }
          disabled={disabled || isDraftStory}
        />
      </FormRow>

      <SwitchRow
        label={t('storySettings:about.favorite')}
        hint={t('storySettings:about.favoriteHint')}
        leading={
          <Icon
            as={Star}
            size="sm"
            className={draft.favorite ? 'fill-warning text-warning' : 'text-fg-muted'}
          />
        }
        checked={draft.favorite}
        onCheckedChange={(favorite) => setDraft((prev) => ({ ...prev, favorite }))}
        disabled={disabled}
        disabledReason={disabledReason}
      />
    </View>
  )
}

export type { AboutPanelProps }
