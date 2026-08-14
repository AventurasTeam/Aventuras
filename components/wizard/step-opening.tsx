import { useState } from 'react'
import { View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
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
import { resolveModelCapabilities } from '@/lib/ai'
import { t } from '@/lib/i18n'
import { appSettingsStore, wizardStore } from '@/lib/stores'

import { AiAssist } from './ai-assist'
import { MemoryCostDisclosure } from './memory-cost-disclosure'
import {
  refineDescriptionAssist,
  refineOpeningAssist,
  resolveWizardAssistModelId,
  runDescriptionAssist,
  runOpeningAssist,
  runTitleAssist,
  type DescriptionAssistValue,
  type OpeningAssistValue,
  type TitleAssistValue,
  type WizardAssistRefine,
  type WizardAssistRun,
} from './wizard-assist'

// DI seams — stories/tests inject fakes so no real provider is hit. Production
// omits all of these and the live ops read the app-settings store.
export type StepOpeningAssistSeams = {
  resolveModelId?: () => string | null
  opening?: WizardAssistRun<OpeningAssistValue>
  refineOpening?: WizardAssistRefine<OpeningAssistValue>
  title?: WizardAssistRun<TitleAssistValue>
  description?: WizardAssistRun<DescriptionAssistValue>
  refineDescription?: WizardAssistRefine<DescriptionAssistValue>
}

export type StepOpeningProps = {
  /** "Set up in Settings" from any assist's not-configured state. */
  onSetupAssist?: () => void
  assist?: StepOpeningAssistSeams
}

export function StepOpening({ onSetupAssist, assist }: StepOpeningProps) {
  const definition = wizardStore.useWizard((s) => s.state.definition)
  const opening = wizardStore.useWizard((s) => s.state.opening)
  const cast = wizardStore.useWizard((s) => s.state.cast)

  const hasContent = opening.content.trim().length > 0
  // wizard.md → Replace-on-existing: a candidate accepted over authored prose
  // is staged here until confirmed, never written straight to the store.
  const [pendingOpening, setPendingOpening] = useState<OpeningAssistValue | null>(null)
  const isAiGenerated = opening.model != null

  const handleSetup = onSetupAssist ?? (() => {})
  const resolveModelId = assist?.resolveModelId ?? (() => resolveWizardAssistModelId())

  // Resolved live against the current cast, not snapshotted at generation
  // time (wizard.md → Committed prose: refs stay intact across cast edits;
  // the user regenerates via ✨ for fresh metadata rather than this label
  // silently going stale-but-blank). Active AND character/item, matching the
  // filter Finish commits through (data-model.md → Scene presence is
  // kind-aware): previewing a ref that Finish then drops would promise the
  // user scene state the story never gets.
  const sceneNames = opening.sceneEntities
    .map((id) =>
      cast
        .find(
          (r) =>
            r.id === id && r.status === 'active' && (r.kind === 'character' || r.kind === 'item'),
        )
        ?.name.trim(),
    )
    .filter((name): name is string => name != null && name.length > 0)
  // Kind-guarded: resolveOpening's reverse substitution doesn't validate kind,
  // so a non-placeholder id that survives it must not render a character's
  // name in the location slot.
  const locationName =
    opening.currentLocationId != null
      ? (cast
          .find(
            (r) =>
              r.id === opening.currentLocationId && r.kind === 'location' && r.status === 'active',
          )
          ?.name.trim() ?? null)
      : null
  // De-duped: a repeated id, two rows sharing a name, or the location id also
  // present in sceneEntities would otherwise render "Aria · Aria".
  const parts = [
    ...new Set([
      ...sceneNames,
      ...(locationName != null && locationName.length > 0 ? [locationName] : []),
    ]),
  ]
  const metadataLabel = isAiGenerated && hasContent && parts.length > 0 ? parts.join(' · ') : null

  // An absent default-story-setting tracks the code default, which is 'local'.
  const embeddingBackend =
    appSettingsStore.useAppSettings((s) => s.defaultStorySettings.embeddingBackend) ?? 'local'
  const embeddingModelId = appSettingsStore.useAppSettings((s) => s.embeddingModelId)
  const embeddingProviderId = appSettingsStore.useAppSettings((s) => s.embeddingProviderId)
  const providers = appSettingsStore.useAppSettings((s) => s.providers)
  const memoryCapabilities =
    embeddingProviderId != null && embeddingModelId != null
      ? resolveModelCapabilities(embeddingProviderId, embeddingModelId, providers)
      : undefined

  return (
    <View className="gap-6">
      <Heading level={1}>{t('wizard:opening.heading')}</Heading>

      <View className="gap-2">
        <View className="flex-row items-center justify-between">
          <Text className="font-medium">{t('wizard:opening.opening.label')}</Text>
          <AiAssist
            ariaLabel={t('wizard:opening.opening.assist')}
            guidancePlaceholder={t('wizard:opening.opening.guidance')}
            run={assist?.opening ?? runOpeningAssist}
            refine={assist?.refineOpening ?? refineOpeningAssist}
            committed={opening}
            resolveModelId={resolveModelId}
            result="prose"
            getProse={(v) => v.content}
            onUse={(v) => {
              if (hasContent) setPendingOpening(v)
              else wizardStore.patchOpening(v)
            }}
            onSetup={handleSetup}
          />
        </View>
        {!hasContent ? (
          <Text size="sm" variant="muted">
            {t('wizard:opening.emptyHint')}
          </Text>
        ) : null}
        <Textarea
          value={opening.content}
          onChangeText={(content) => wizardStore.patchOpening({ content })}
          rows={8}
          placeholder={t('wizard:opening.placeholder')}
          aria-label={t('wizard:opening.opening.label')}
        />
        {metadataLabel != null ? (
          <Text size="sm" variant="muted">
            {t('wizard:opening.sceneMetadata', { value: metadataLabel })}
          </Text>
        ) : null}
      </View>

      <View className="gap-4">
        <Text className="font-medium">{t('wizard:opening.storyName')}</Text>

        <FormRow label={t('wizard:opening.title.label')}>
          <View className="flex-row items-center gap-2">
            <View className="flex-1">
              <Input
                value={definition.title}
                onChangeText={(title) => wizardStore.patchDefinition({ title })}
                placeholder={t('wizard:opening.title.placeholder')}
                aria-label={t('wizard:opening.title.label')}
              />
            </View>
            <AiAssist
              ariaLabel={t('wizard:opening.title.assist')}
              guidancePlaceholder={t('wizard:opening.title.guidance')}
              run={assist?.title ?? runTitleAssist}
              resolveModelId={resolveModelId}
              result="chips"
              getChips={(v) => v.titles}
              onPickChip={(chip) => wizardStore.patchDefinition({ title: chip })}
              onSetup={handleSetup}
            />
          </View>
        </FormRow>

        <FormRow label={t('wizard:opening.description.label')}>
          <View className="flex-row items-center gap-2">
            <View className="flex-1">
              <Input
                value={definition.description}
                onChangeText={(description) => wizardStore.patchDefinition({ description })}
                placeholder={t('wizard:opening.description.placeholder')}
                aria-label={t('wizard:opening.description.label')}
              />
            </View>
            <AiAssist
              ariaLabel={t('wizard:opening.description.assist')}
              guidancePlaceholder={t('wizard:opening.description.guidance')}
              run={assist?.description ?? runDescriptionAssist}
              refine={assist?.refineDescription ?? refineDescriptionAssist}
              committed={{ description: definition.description }}
              resolveModelId={resolveModelId}
              result="prose"
              getProse={(v) => v.description}
              onUse={(v) => wizardStore.patchDefinition({ description: v.description })}
              onSetup={handleSetup}
            />
          </View>
        </FormRow>
      </View>

      <MemoryCostDisclosure embeddingBackend={embeddingBackend} capabilities={memoryCapabilities} />

      {/* wizard.md → Committed prose: accepting a candidate over a non-empty
          opening confirms first, the same guard genre and tone already use. */}
      <AlertDialog
        open={pendingOpening != null}
        onOpenChange={(next) => {
          if (!next) setPendingOpening(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('wizard:opening.replaceConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('wizard:opening.replaceConfirm.body')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary">
                <Text>{t('wizard:opening.replaceConfirm.cancel')}</Text>
              </Button>
            </AlertDialogCancel>
            <Button
              onPress={() => {
                if (pendingOpening) wizardStore.patchOpening(pendingOpening)
                setPendingOpening(null)
              }}
            >
              <Text>{t('wizard:opening.replaceConfirm.confirm')}</Text>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  )
}
