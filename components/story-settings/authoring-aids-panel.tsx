import { MoreVertical } from 'lucide-react-native'
import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { View } from 'react-native'

import { SuggestionCategoriesEditor } from '@/components/compounds/suggestion-categories-editor'
import { SwitchRow } from '@/components/compounds/switch-row'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { IconAction } from '@/components/ui/icon-action'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Stepper } from '@/components/ui/stepper'
import { Text } from '@/components/ui/text'
import {
  DEFAULT_SUGGESTION_CATEGORIES,
  isStoryMode,
  SUGGESTION_COUNT_MAX,
  SUGGESTION_COUNT_MIN,
  type StoryDefinition,
  type StorySettings,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { appSettingsStore } from '@/lib/stores'
import { NEUTRAL_ACCENT } from '@/lib/themes'

import { useStorySettingsSection } from './save-session'
import {
  SUGGESTION_SWATCHES,
  sameStoredCategories,
  toDraft,
  toStored,
  validateDraft,
} from './suggestion-categories-draft'

/** Story palettes must keep one category; an empty one stops emission entirely. */
const MIN_CATEGORIES = 1

type AuthoringAidsPanelProps = {
  settings: StorySettings
  /** `stories.definition` is a separate nullable column; null disables Reset. */
  definition: StoryDefinition | null
  disabled?: boolean
  disabledReason?: string
}

export function AuthoringAidsPanel({
  settings,
  definition,
  disabled = false,
  disabledReason,
}: AuthoringAidsPanelProps) {
  const [draft, setDraft] = useState(() => toDraft(settings.suggestionCategories))
  const [enabled, setEnabled] = useState(settings.suggestionsEnabled)
  const [count, setCount] = useState(settings.suggestionCount)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  // rn-primitives' Popover Root is uncontrolled; closing it is the trigger's
  // own imperative handle, not an `open` prop.
  const menuTriggerRef = useRef<ComponentRef<typeof PopoverTrigger>>(null)

  const appPalettes = appSettingsStore.useAppSettings((s) => s.defaultSuggestionCategories)

  // Against the normalized baseline, not the raw row: `toDraft` sorts by `order`
  // and `toStored` trims labels, so a row predating either normalization would
  // read as an edit the user never made — and Discard, which re-derives the same
  // draft, could not clear it. Normalizing lands on the next real save instead.
  const baseline = toStored(toDraft(settings.suggestionCategories))
  const categoriesDirty = !sameStoredCategories(toStored(draft), baseline)

  const dirtyFields: string[] = []
  if (enabled !== settings.suggestionsEnabled) {
    dirtyFields.push(t('storySettings:generation.field.suggestions'))
  }
  if (count !== settings.suggestionCount) {
    dirtyFields.push(t('storySettings:generation.field.suggestionCount'))
  }
  if (categoriesDirty) {
    dirtyFields.push(t('storySettings:generation.field.suggestionCategories'))
  }

  // Gated on the categories being dirty: a collision already sitting in stored
  // data must not refuse an unrelated toggle flip the user did author.
  const validity = validateDraft(draft)
  const invalidReason =
    categoriesDirty && !validity.ok
      ? t(`storySettings:generation.invalid.${validity.problem}`)
      : undefined

  useStorySettingsSection({
    id: 'authoring-aids',
    tab: 'generation',
    dirtyFields,
    invalidReason,
    getPatch: () => ({
      suggestionsEnabled: enabled,
      suggestionCount: count,
      suggestionCategories: toStored(draft),
    }),
    // Reads the `settings` prop directly: the hook writes its callback ref
    // during render, so this closure is already the post-save one.
    reset: () => {
      setDraft(toDraft(settings.suggestionCategories))
      setEnabled(settings.suggestionsEnabled)
      setCount(settings.suggestionCount)
    },
  })

  // Checked, not just typed: `definition` reaches the store as a `$type` cast
  // over stored JSON, so an off-enum mode would index the palettes to undefined
  // and throw on `.length` inside the confirm handler — where no error boundary
  // catches it and the user just sees the dialog close with nothing changed.
  const rawMode = definition?.mode
  const mode = isStoryMode(rawMode) ? rawMode : null
  const modeProblem = definition == null ? 'missing' : mode == null ? 'unrecognized' : null

  useEffect(() => {
    if (modeProblem !== 'unrecognized') return
    logger.error('action_layer.unrecognized_story_mode', { mode: String(rawMode) })
  }, [modeProblem, rawMode])

  const confirmReset = () => {
    if (disabled) return
    setResetConfirmOpen(false)
    if (mode == null) return
    // Same resolution buildStorySettings uses at creation: an empty app-level
    // palette means "not configured", not "the user wants none".
    const appPalette = appPalettes[mode]
    setDraft(toDraft(appPalette.length > 0 ? appPalette : DEFAULT_SUGGESTION_CATEGORIES[mode]))
  }

  const confirmDelete = () => {
    if (disabled) return
    const id = pendingDeleteId
    setPendingDeleteId(null)
    if (id == null) return
    setDraft((prev) => prev.filter((row) => row.id !== id))
  }

  const dialogOpen = pendingDeleteId != null || resetConfirmOpen

  return (
    <View testID="authoring-aids-panel" className="gap-4">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="font-semibold">{t('storySettings:generation.authoringAids')}</Text>
        <Popover ariaLabel={t('storySettings:generation.menu')}>
          <PopoverTrigger ref={menuTriggerRef} asChild>
            <IconAction
              icon={MoreVertical}
              label={t('storySettings:generation.menu')}
              size="sm"
              disabled={disabled || dialogOpen}
              disabledReason={disabled ? disabledReason : undefined}
            />
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1">
            <Button
              variant="ghost"
              disabled={disabled || mode == null || !enabled}
              disabledReason={disabled ? disabledReason : undefined}
              onPress={() => {
                if (disabled) return
                menuTriggerRef.current?.close()
                setResetConfirmOpen(true)
              }}
            >
              <Text>{t('storySettings:generation.reset')}</Text>
            </Button>
            {modeProblem != null ? (
              <Text size="xs" variant="muted" className="px-row-x-md pb-2">
                {t(`storySettings:generation.resetUnavailable.${modeProblem}`)}
              </Text>
            ) : null}
          </PopoverContent>
        </Popover>
      </View>

      <SwitchRow
        label={t('storySettings:generation.suggestions')}
        hint={t('storySettings:generation.suggestionsHint')}
        checked={enabled}
        onCheckedChange={setEnabled}
        disabled={disabled}
        disabledReason={disabledReason}
      />

      <View className="flex-row items-center justify-between gap-3">
        <Text>{t('storySettings:generation.suggestionCount')}</Text>
        <Stepper
          testID="suggestion-count"
          value={count}
          min={SUGGESTION_COUNT_MIN}
          max={SUGGESTION_COUNT_MAX}
          onChange={setCount}
          label={t('storySettings:generation.suggestionCount')}
          decrementLabel={t('storySettings:generation.countDecrement')}
          incrementLabel={t('storySettings:generation.countIncrement')}
          disabled={disabled || !enabled}
          disabledReason={disabled ? disabledReason : undefined}
        />
      </View>

      <View className="gap-2">
        <Text size="sm" variant="muted">
          {t('storySettings:generation.categories')}
        </Text>
        <SuggestionCategoriesEditor
          categories={draft}
          onChange={setDraft}
          onRequestDelete={setPendingDeleteId}
          minRows={MIN_CATEGORIES}
          swatches={SUGGESTION_SWATCHES}
          fallbackColor={NEUTRAL_ACCENT}
          disabled={disabled || !enabled}
          disabledReason={disabled ? disabledReason : undefined}
        />
      </View>

      <AlertDialog
        open={pendingDeleteId != null}
        onOpenChange={(next) => {
          if (!next) setPendingDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('storySettings:generation.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('storySettings:generation.deleteBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary">
                <Text>{t('cancel')}</Text>
              </Button>
            </AlertDialogCancel>
            <Button
              testID="confirm-delete-category"
              variant="destructive"
              disabled={disabled}
              disabledReason={disabledReason}
              onPress={confirmDelete}
            >
              <Text>{t('storySettings:generation.deleteConfirm')}</Text>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('storySettings:generation.resetTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('storySettings:generation.resetBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary">
                <Text>{t('cancel')}</Text>
              </Button>
            </AlertDialogCancel>
            <Button
              testID="confirm-reset-categories"
              variant="primary"
              disabled={disabled}
              disabledReason={disabledReason}
              onPress={confirmReset}
            >
              <Text>{t('storySettings:generation.resetConfirm')}</Text>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  )
}

export type { AuthoringAidsPanelProps }
