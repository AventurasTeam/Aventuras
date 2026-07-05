import { View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { Heading } from '@/components/ui/heading'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import type { GenerateStructuredResult } from '@/lib/ai'
import { t } from '@/lib/i18n'
import { wizardStore } from '@/lib/stores'

import { AiAssist } from './ai-assist'
import {
  resolveWizardAssistModelId,
  runDescriptionAssist,
  runOpeningAssist,
  runTitleAssist,
  type DescriptionAssistValue,
  type OpeningAssistValue,
  type TitleAssistValue,
} from './wizard-assist'

type WizardAssistRun<T> = (
  guidance: string,
  signal: AbortSignal,
) => Promise<GenerateStructuredResult<T>>

// DI seams — stories/tests inject fakes so no real provider is hit. Production
// omits all of these and the live ops read the app-settings store.
export type StepOpeningAssistSeams = {
  resolveModelId?: () => string | null
  opening?: WizardAssistRun<OpeningAssistValue>
  title?: WizardAssistRun<TitleAssistValue>
  description?: WizardAssistRun<DescriptionAssistValue>
}

export type StepOpeningProps = {
  /** "Set up in Settings" from any assist's not-configured state. */
  onSetupAssist?: () => void
  assist?: StepOpeningAssistSeams
}

export function StepOpening({ onSetupAssist, assist }: StepOpeningProps) {
  const definition = wizardStore.useWizard((s) => s.state.definition)
  const opening = wizardStore.useWizard((s) => s.state.opening)
  const leadName = wizardStore.useWizard((s) => s.state.leadName)
  const leadEntityId = wizardStore.useWizard((s) => s.state.leadEntityId)

  const hasContent = opening.content.trim().length > 0
  const isAiGenerated = opening.model != null

  const handleSetup = onSetupAssist ?? (() => {})
  const resolveModelId = assist?.resolveModelId ?? (() => resolveWizardAssistModelId())

  const sceneName =
    leadEntityId != null &&
    opening.sceneEntities.includes(leadEntityId) &&
    leadName.trim().length > 0
      ? leadName
      : null
  const metadataLabel = isAiGenerated && hasContent && sceneName != null ? sceneName : null

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
            resolveModelId={resolveModelId}
            result="prose"
            getProse={(v) => v.content}
            onUse={(v) => wizardStore.patchOpening(v)}
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
              resolveModelId={resolveModelId}
              result="prose"
              getProse={(v) => v.description}
              onUse={(v) => wizardStore.patchDefinition({ description: v.description })}
              onSetup={handleSetup}
            />
          </View>
        </FormRow>
      </View>
    </View>
  )
}
