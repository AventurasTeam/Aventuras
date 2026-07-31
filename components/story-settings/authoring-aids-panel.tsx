import { MoreVertical } from 'lucide-react-native'
import { useRef, useState, type ComponentRef } from 'react'
import { View } from 'react-native'

import { SuggestionCategoriesEditor } from '@/components/compounds/suggestion-categories-editor'
import { SwitchRow } from '@/components/compounds/switch-row'
import {
  AlertDialog,
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
import { DEFAULT_SUGGESTION_CATEGORIES, type StoryDefinition, type StorySettings } from '@/lib/db'
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

const SUGGESTION_COUNT_MIN = 1
const SUGGESTION_COUNT_MAX = 6

type AuthoringAidsPanelProps = {
  settings: StorySettings
  /** `stories.definition` is a separate nullable column; null disables Reset. */
  definition: StoryDefinition | null
}

export function AuthoringAidsPanel({ settings, definition }: AuthoringAidsPanelProps) {
  const [draft, setDraft] = useState(() => toDraft(settings.suggestionCategories))
  const [enabled, setEnabled] = useState(settings.suggestionsEnabled)
  const [count, setCount] = useState(settings.suggestionCount)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  // rn-primitives' Popover Root is uncontrolled; closing it is the trigger's
  // own imperative handle, not an `open` prop.
  const menuTriggerRef = useRef<ComponentRef<typeof PopoverTrigger>>(null)

  const appPalettes = appSettingsStore.useAppSettings((s) => s.defaultSuggestionCategories)

  const storedDraft = toStored(draft)
  const categoriesDirty = !sameStoredCategories(storedDraft, settings.suggestionCategories)

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

  const mode = definition?.mode ?? null
  const confirmReset = () => {
    setResetConfirmOpen(false)
    if (mode == null) return
    // Same resolution buildStorySettings uses at creation: an empty app-level
    // palette means "not configured", not "the user wants none".
    const appPalette = appPalettes[mode]
    setDraft(toDraft(appPalette.length > 0 ? appPalette : DEFAULT_SUGGESTION_CATEGORIES[mode]))
  }

  const confirmDelete = () => {
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
              disabled={dialogOpen}
            />
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1">
            <Button
              variant="ghost"
              disabled={mode == null || !enabled}
              onPress={() => {
                menuTriggerRef.current?.close()
                setResetConfirmOpen(true)
              }}
            >
              <Text>{t('storySettings:generation.reset')}</Text>
            </Button>
            {mode == null ? (
              <Text size="xs" variant="muted" className="px-row-x-md pb-2">
                {t('storySettings:generation.resetUnavailable')}
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
      />

      <View className="flex-row items-center justify-between gap-3">
        <Text>{t('storySettings:generation.suggestionCount')}</Text>
        <Stepper
          testID="suggestion-count"
          value={count}
          min={SUGGESTION_COUNT_MIN}
          max={SUGGESTION_COUNT_MAX}
          onChange={setCount}
          decrementLabel={t('storySettings:generation.countDecrement')}
          incrementLabel={t('storySettings:generation.countIncrement')}
          disabled={!enabled}
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
          swatches={SUGGESTION_SWATCHES}
          fallbackColor={NEUTRAL_ACCENT}
          disabled={!enabled}
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
            <Button variant="secondary" onPress={() => setPendingDeleteId(null)}>
              <Text>{t('cancel')}</Text>
            </Button>
            <Button testID="confirm-delete-category" variant="destructive" onPress={confirmDelete}>
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
            <Button variant="secondary" onPress={() => setResetConfirmOpen(false)}>
              <Text>{t('cancel')}</Text>
            </Button>
            <Button testID="confirm-reset-categories" variant="primary" onPress={confirmReset}>
              <Text>{t('storySettings:generation.resetConfirm')}</Text>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  )
}

export type { AuthoringAidsPanelProps }
