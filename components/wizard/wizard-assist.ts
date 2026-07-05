import type { ZodType } from 'zod'

import {
  generateStructured,
  resolveModel,
  type GenerateStructuredResult,
  type ResolveModelConfig,
} from '@/lib/ai'
import { generateId, IdBiMap, parseAndSubstitute, substituteIds } from '@/lib/ids'
import { renderTemplate, TEMPLATE_IDS, type TemplateId } from '@/lib/prompts'
import { appSettingsStore, wizardStore } from '@/lib/stores'
import { descriptionOutputSchema, openingOutputSchema, titleChipsSchema } from '@/lib/wizard'

import { needsLead } from './step-frame-logic'

const ASSIST_TARGET = 'wizard-assist'

/** Store-ready opening: model placeholders already resolved back to real ids. */
export type OpeningAssistValue = {
  content: string
  sceneEntities: string[]
  currentLocationId: string | null
  model: string | null
}
export type TitleAssistValue = { titles: string[] }
export type DescriptionAssistValue = { description: string }

export type WizardAssistDeps = {
  /** Test seam — production reads the live app-settings store. */
  resolveConfig?: () => ResolveModelConfig
  /** Test seam — production uses the real structured model call. */
  generate?: typeof generateStructured
}

function config(deps?: WizardAssistDeps): ResolveModelConfig {
  return deps?.resolveConfig?.() ?? appSettingsStore.getAppSettings()
}

export function resolveWizardAssistModelId(deps?: WizardAssistDeps): string | null {
  const resolved = resolveModel(ASSIST_TARGET, config(deps))
  return resolved.ok ? resolved.modelId : null
}

// Render a wizard template from the full working-state (+ guidance) and call the
// model. Ids in the state are swapped to placeholders through `idMap` first, so a
// caller that reverse-substitutes the reply reads real ids back out.
function generateFromState<T>(
  templateId: TemplateId,
  schema: ZodType<T>,
  guidance: string,
  idMap: IdBiMap,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
): Promise<GenerateStructuredResult<T>> {
  const context = substituteIds({ ...wizardStore.getWizard().state, guidance }, idMap)
  const prompt = renderTemplate(templateId, context)
  const call = deps?.generate ?? generateStructured
  return call(ASSIST_TARGET, prompt, schema, config(deps), signal)
}

// The opening template addresses the lead by its cast id, so the id must exist
// before rendering. Finish carries the same safety-net mint for paths that never
// ran opening-assist.
function ensureLeadId(): void {
  const { definition, leadEntityId } = wizardStore.getWizard().state
  if (!needsLead(definition.mode, definition.narration)) return
  if (leadEntityId == null) wizardStore.setLeadEntityId(generateId('char'))
}

function resolveOpening(
  value: { prose: string; sceneEntities: string[]; currentLocationId: string | null },
  idMap: IdBiMap,
  deps?: WizardAssistDeps,
): OpeningAssistValue {
  try {
    return {
      content: value.prose,
      sceneEntities: parseAndSubstitute(value.sceneEntities, idMap),
      currentLocationId:
        value.currentLocationId == null ? null : parseAndSubstitute(value.currentLocationId, idMap),
      model: resolveWizardAssistModelId(deps) ?? ASSIST_TARGET,
    }
  } catch {
    // Unresolvable placeholder → treat the prose as user-written: keep it, drop
    // the metadata (a later classifier pass recovers refs).
    return { content: value.prose, sceneEntities: [], currentLocationId: null, model: null }
  }
}

export async function runOpeningAssist(
  guidance: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
): Promise<GenerateStructuredResult<OpeningAssistValue>> {
  ensureLeadId()
  const idMap = new IdBiMap()
  const result = await generateFromState(
    TEMPLATE_IDS.wizardOpening,
    openingOutputSchema,
    guidance,
    idMap,
    signal,
    deps,
  )
  if (result.status !== 'ok') return result
  return { status: 'ok', value: resolveOpening(result.value, idMap, deps) }
}

export function runTitleAssist(
  guidance: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
): Promise<GenerateStructuredResult<TitleAssistValue>> {
  return generateFromState(
    TEMPLATE_IDS.wizardTitleChips,
    titleChipsSchema,
    guidance,
    new IdBiMap(),
    signal,
    deps,
  )
}

export function runDescriptionAssist(
  guidance: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
): Promise<GenerateStructuredResult<DescriptionAssistValue>> {
  return generateFromState(
    TEMPLATE_IDS.wizardDescription,
    descriptionOutputSchema,
    guidance,
    new IdBiMap(),
    signal,
    deps,
  )
}
