import { useMemo, useState } from 'react'
import { View } from 'react-native'

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
import { Heading } from '@/components/ui/heading'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/lib/i18n'
import { wizardStore } from '@/lib/stores'
import { GENRE_PRESETS, TONE_PRESETS } from '@/lib/wizard'

import { AiAssist } from './ai-assist'
import { LoreList } from './lore-list'
import { PresetBrowser } from './preset-browser'
import {
  invalidLoreRowIds,
  labeledPatch,
  needsReplaceConfirm,
  type LabeledField,
  type LabeledPrompt,
} from './step-world-logic'
import {
  refineGenreAssist,
  refineSettingAssist,
  refineToneAssist,
  resolveWizardAssistModelId,
  runGenreAssist,
  runLoreAssist,
  runSettingAssist,
  runToneAssist,
  type GenreAssistValue,
  type LoreAssistValue,
  type SettingAssistValue,
  type ToneAssistValue,
  type WizardAssistRefine,
  type WizardAssistRun,
} from './wizard-assist'

// DI seams — stories/tests inject fakes so no real provider is hit. Production
// omits all of these and the live ops read the app-settings store.
export type StepWorldAssistSeams = {
  resolveModelId?: () => string | null
  genre?: WizardAssistRun<GenreAssistValue>
  genreRefine?: WizardAssistRefine<GenreAssistValue>
  tone?: WizardAssistRun<ToneAssistValue>
  toneRefine?: WizardAssistRefine<ToneAssistValue>
  setting?: WizardAssistRun<SettingAssistValue>
  settingRefine?: WizardAssistRefine<SettingAssistValue>
  lore?: WizardAssistRun<LoreAssistValue>
}

export type StepWorldProps = {
  /** "Set up in Settings" from any assist's not-configured state. */
  onSetupAssist?: () => void
  assist?: StepWorldAssistSeams
}

type PendingReplace = { field: LabeledField; next: LabeledPrompt } | null

// wizard.md → Replace-on-existing. Both entry points funnel through here so a
// preset pick and an AI accept can never disagree about when to confirm.
function useGuardedApply() {
  const [pending, setPending] = useState<PendingReplace>(null)

  const request = (field: LabeledField, current: LabeledPrompt, next: LabeledPrompt) => {
    if (needsReplaceConfirm(current)) setPending({ field, next })
    else wizardStore.patchDefinition(labeledPatch(field, next))
  }

  const confirm = () => {
    if (pending) wizardStore.patchDefinition(labeledPatch(pending.field, pending.next))
    setPending(null)
  }

  // Cancel drops the staged value and never touches the store — the user's
  // authored label and body survive untouched.
  const cancel = () => setPending(null)

  return { pending, request, confirm, cancel }
}

export function StepWorld({ onSetupAssist, assist }: StepWorldProps) {
  const definition = wizardStore.useWizard((s) => s.state.definition)
  const lore = wizardStore.useWizard((s) => s.state.lore)

  const handleSetup = onSetupAssist ?? (() => {})
  const resolveModelId = assist?.resolveModelId ?? (() => resolveWizardAssistModelId())

  const guardedApply = useGuardedApply()
  const invalidLoreIds = useMemo(() => invalidLoreRowIds(lore), [lore])

  const replaceTitle =
    guardedApply.pending != null
      ? // One full sentence per field rather than an interpolated noun: the
        // field name inflects with the verb in several target languages.
        guardedApply.pending.field === 'genre'
        ? t('wizard:world.replaceConfirm.titleGenre', { name: guardedApply.pending.next.label })
        : t('wizard:world.replaceConfirm.titleTone', { name: guardedApply.pending.next.label })
      : ''

  return (
    <View className="gap-6">
      <Heading level={1}>{t('wizard:world.heading')}</Heading>

      <View className="gap-2">
        <Text className="font-medium">{t('wizard:world.genre.label')}</Text>
        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            <Input
              value={definition.genre.label}
              onChangeText={(label) =>
                wizardStore.patchDefinition({ genre: { ...definition.genre, label } })
              }
              placeholder={t('wizard:world.genre.placeholder')}
              aria-label={t('wizard:world.genre.label')}
            />
          </View>
          <PresetBrowser
            presets={GENRE_PRESETS}
            ariaLabel={t('wizard:world.browseGenrePresets')}
            onPick={(preset) =>
              guardedApply.request('genre', definition.genre, {
                label: preset.displayName,
                promptBody: preset.promptBody,
              })
            }
          />
          <AiAssist
            ariaLabel={t('wizard:world.genre.assist')}
            guidancePlaceholder={t('wizard:world.genre.guidance')}
            run={assist?.genre ?? runGenreAssist}
            refine={assist?.genreRefine ?? refineGenreAssist}
            resolveModelId={resolveModelId}
            result="prose"
            getProse={(v) => `${v.label}\n\n${v.promptBody}`}
            onUse={(v) => guardedApply.request('genre', definition.genre, v)}
            onSetup={handleSetup}
          />
        </View>
        <Textarea
          value={definition.genre.promptBody}
          onChangeText={(promptBody) =>
            wizardStore.patchDefinition({ genre: { ...definition.genre, promptBody } })
          }
          rows={6}
          placeholder={t('wizard:world.genre.bodyPlaceholder')}
          aria-label={t('wizard:world.genre.bodyLabel')}
        />
      </View>

      <View className="gap-2">
        <Text className="font-medium">{t('wizard:world.tone.label')}</Text>
        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            <Input
              value={definition.tone.label}
              onChangeText={(label) =>
                wizardStore.patchDefinition({ tone: { ...definition.tone, label } })
              }
              placeholder={t('wizard:world.tone.placeholder')}
              aria-label={t('wizard:world.tone.label')}
            />
          </View>
          <PresetBrowser
            presets={TONE_PRESETS}
            ariaLabel={t('wizard:world.browseTonePresets')}
            onPick={(preset) =>
              guardedApply.request('tone', definition.tone, {
                label: preset.displayName,
                promptBody: preset.promptBody,
              })
            }
          />
          <AiAssist
            ariaLabel={t('wizard:world.tone.assist')}
            guidancePlaceholder={t('wizard:world.tone.guidance')}
            run={assist?.tone ?? runToneAssist}
            refine={assist?.toneRefine ?? refineToneAssist}
            resolveModelId={resolveModelId}
            result="prose"
            getProse={(v) => `${v.label}\n\n${v.promptBody}`}
            onUse={(v) => guardedApply.request('tone', definition.tone, v)}
            onSetup={handleSetup}
          />
        </View>
        <Textarea
          value={definition.tone.promptBody}
          onChangeText={(promptBody) =>
            wizardStore.patchDefinition({ tone: { ...definition.tone, promptBody } })
          }
          rows={6}
          placeholder={t('wizard:world.tone.bodyPlaceholder')}
          aria-label={t('wizard:world.tone.bodyLabel')}
        />
      </View>

      <View className="gap-2">
        <View className="flex-row items-center justify-between">
          <Text className="font-medium">{t('wizard:world.setting.label')}</Text>
          <AiAssist
            ariaLabel={t('wizard:world.setting.assist')}
            guidancePlaceholder={t('wizard:world.setting.guidance')}
            run={assist?.setting ?? runSettingAssist}
            refine={assist?.settingRefine ?? refineSettingAssist}
            resolveModelId={resolveModelId}
            result="prose"
            getProse={(v) => v.setting}
            onUse={(v) => wizardStore.patchDefinition({ setting: v.setting })}
            onSetup={handleSetup}
          />
        </View>
        <Textarea
          value={definition.setting}
          onChangeText={(setting) => wizardStore.patchDefinition({ setting })}
          rows={6}
          placeholder={t('wizard:world.setting.placeholder')}
          aria-label={t('wizard:world.setting.label')}
        />
      </View>

      <LoreList
        rows={lore}
        invalidIds={invalidLoreIds}
        headerAction={
          <AiAssist
            ariaLabel={t('wizard:world.lore.suggest')}
            run={assist?.lore ?? runLoreAssist}
            resolveModelId={resolveModelId}
            result="list"
            // `payload` carries the row whole — mapping back from name/detail alone
            // would drop `category`.
            getItems={(v) =>
              v.lore.map((row) => ({ name: row.title, detail: row.body, payload: row }))
            }
            existingNames={lore.map((row) => row.title)}
            onImport={(items) => wizardStore.importLore(items.map((item) => item.payload))}
            onSetup={handleSetup}
          />
        }
      />

      <AlertDialog
        open={guardedApply.pending != null}
        onOpenChange={(next) => {
          if (!next) guardedApply.cancel()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{replaceTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t('wizard:world.replaceConfirm.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary">
                <Text>{t('wizard:world.replaceConfirm.cancel')}</Text>
              </Button>
            </AlertDialogCancel>
            {/* Plain button — an AlertDialogAction wrapper would also fire
                onOpenChange(false), which is harmless (cancel() no-ops once pending
                is null) but confirm() is kept as the one path that writes the store. */}
            <Button onPress={guardedApply.confirm}>
              <Text>{t('wizard:world.replaceConfirm.confirm')}</Text>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  )
}
