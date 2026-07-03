import { useRef } from 'react'
import { View } from 'react-native'
import type { z } from 'zod'

import { FormRow } from '@/components/compounds/form-row'
import { Heading } from '@/components/ui/heading'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { resolveModel, type ResolveModelConfig } from '@/lib/ai'
import { t } from '@/lib/i18n'
import { generateId, IdBiMap, parseAndSubstitute } from '@/lib/ids'
import { TEMPLATE_IDS, renderTemplate } from '@/lib/prompts'
import { appSettingsStore, wizardStore } from '@/lib/stores'
import {
  descriptionOutputSchema,
  openingOutputSchema,
  titleChipsSchema,
  type OpeningOutput,
  type WizardAssistResult,
} from '@/lib/wizard'

import { AiAssist } from './ai-assist'
import { needsLead } from './step-frame-logic'

type TitleOutput = z.infer<typeof titleChipsSchema>
type DescriptionOutput = z.infer<typeof descriptionOutputSchema>

type RunAssist<T> = (
  prompt: string,
  schema: z.ZodType<T>,
  config: ResolveModelConfig,
  signal: AbortSignal,
) => Promise<WizardAssistResult<T>>

// DI seams mirroring AiAssist's own `runAssist` / `resolveConfig` props — stories
// and tests inject fakes so no real provider is hit. Production omits all of these.
export type StepOpeningAssistSeams = {
  resolveConfig?: () => ResolveModelConfig
  opening?: RunAssist<OpeningOutput>
  title?: RunAssist<TitleOutput>
  description?: RunAssist<DescriptionOutput>
}

export type StepOpeningProps = {
  /** "Set up in Settings" from any assist's not-configured state. */
  onSetupAssist?: () => void
  assist?: StepOpeningAssistSeams
}

const OPENING_MODEL_MARKER = 'wizard-assist'

export function StepOpening({ onSetupAssist, assist }: StepOpeningProps) {
  const definition = wizardStore.useWizard((s) => s.state.definition)
  const opening = wizardStore.useWizard((s) => s.state.opening)
  const leadName = wizardStore.useWizard((s) => s.state.leadName)
  const leadEntityId = wizardStore.useWizard((s) => s.state.leadEntityId)

  const requiresLead = needsLead(definition.mode, definition.narration)
  const hasContent = opening.content.trim().length > 0
  const isAiGenerated = opening.model != null

  const resolveConfig: () => ResolveModelConfig =
    assist?.resolveConfig ?? (() => appSettingsStore.getAppSettings())
  const handleSetup = onSetupAssist ?? (() => {})

  // The idMap allocated at buildPrompt time is reused at onUse time so the
  // model's placeholder round-trips back to the SAME real lead id.
  const openingIdMapRef = useRef<IdBiMap>(new IdBiMap())

  function buildOpeningPrompt(): string {
    const idMap = new IdBiMap()
    openingIdMapRef.current = idMap
    let lead: { name: string; id: string } | undefined
    if (requiresLead) {
      let id = leadEntityId
      if (id == null) {
        id = generateId('char')
        wizardStore.setLeadEntityId(id)
      }
      lead = { name: leadName, id: idMap.allocate(id) }
    }
    return renderTemplate(TEMPLATE_IDS.wizardOpening, { definition, lead })
  }

  function commitOpening(value: OpeningOutput) {
    const modelId = (() => {
      const resolved = resolveModel('wizard-assist', resolveConfig())
      return resolved.ok ? resolved.modelId : OPENING_MODEL_MARKER
    })()
    try {
      const sceneEntities = parseAndSubstitute(value.sceneEntities, openingIdMapRef.current)
      const currentLocationId =
        value.currentLocationId == null
          ? null
          : parseAndSubstitute(value.currentLocationId, openingIdMapRef.current)
      wizardStore.patchOpening({
        content: value.prose,
        sceneEntities,
        currentLocationId,
        model: modelId,
      })
    } catch {
      // Malformed refs (an unresolvable placeholder) → treat the prose as
      // user-written: keep it, drop the metadata (turn-2 classifier recovers it).
      wizardStore.patchOpening({
        content: value.prose,
        sceneEntities: [],
        currentLocationId: null,
        model: null,
      })
    }
  }

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
            buildPrompt={buildOpeningPrompt}
            schema={openingOutputSchema}
            result="prose"
            getProse={(v) => v.prose}
            onUse={commitOpening}
            onSetup={handleSetup}
            resolveConfig={resolveConfig}
            runAssist={assist?.opening}
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
              buildPrompt={() =>
                renderTemplate(TEMPLATE_IDS.wizardTitleChips, { opening: opening.content })
              }
              schema={titleChipsSchema}
              result="chips"
              getChips={(v) => v.titles}
              onPickChip={(chip) => wizardStore.patchDefinition({ title: chip })}
              onSetup={handleSetup}
              resolveConfig={resolveConfig}
              runAssist={assist?.title}
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
              buildPrompt={() =>
                renderTemplate(TEMPLATE_IDS.wizardDescription, { opening: opening.content })
              }
              schema={descriptionOutputSchema}
              result="prose"
              getProse={(v) => v.description}
              onUse={(v) => wizardStore.patchDefinition({ description: v.description })}
              onSetup={handleSetup}
              resolveConfig={resolveConfig}
              runAssist={assist?.description}
            />
          </View>
        </FormRow>
      </View>
    </View>
  )
}
