import type { ZodType } from 'zod'

import {
  generateStructured,
  resolveModel,
  type GenerateStructuredResult,
  type ResolveModelConfig,
} from '@/lib/ai'
import { IdBiMap, parseAndSubstitute, substituteIds } from '@/lib/ids'
import { renderTemplate, TEMPLATE_IDS, type TemplateId } from '@/lib/prompts'
import { appSettingsStore, wizardStore } from '@/lib/stores'
import {
  castSuggestionsSchema,
  descriptionOutputSchema,
  labeledPromptOutputSchema,
  loreSuggestionsSchema,
  openingOutputSchema,
  settingOutputSchema,
  titleChipsSchema,
  type CastSuggestions,
} from '@/lib/wizard'

const ASSIST_TARGET = 'wizard-assist'

/** Shared shape for every wizard-assist "generate" call — one per step-body file. */
export type WizardAssistRun<T> = (
  guidance: string,
  signal: AbortSignal,
) => Promise<GenerateStructuredResult<T>>

/**
 * List-result runs additionally receive the names already on screen, so a
 * `Generate more` asks for something the earlier pages did not already contain.
 */
export type WizardAssistListRun<T> = (
  guidance: string,
  signal: AbortSignal,
  exclude: readonly string[],
) => Promise<GenerateStructuredResult<T>>

/** Shared shape for every wizard-assist "refine" call (prose results only). */
export type WizardAssistRefine<T> = (
  current: T,
  instruction: string,
  signal: AbortSignal,
) => Promise<GenerateStructuredResult<T>>

/** Store-ready opening: model placeholders already resolved back to real ids. */
export type OpeningAssistValue = {
  content: string
  sceneEntities: string[]
  currentLocationId: string | null
  model: string | null
}
export type TitleAssistValue = { titles: string[] }
export type DescriptionAssistValue = { description: string }
export type LoreAssistValue = { lore: { title: string; body: string; category: string }[] }
export type CastAssistValue = CastSuggestions
export type GenreAssistValue = { label: string; promptBody: string }
export type ToneAssistValue = { label: string; promptBody: string }
export type SettingAssistValue = { setting: string }

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
  extra?: Record<string, unknown>,
): Promise<GenerateStructuredResult<T>> {
  const context = substituteIds({ ...wizardStore.getWizard().state, guidance, ...extra }, idMap)
  const prompt = renderTemplate(templateId, context)
  const call = deps?.generate ?? generateStructured
  return call(ASSIST_TARGET, prompt, schema, config(deps), signal)
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

// Generate and refine share the opening's id round-trip: real ids go into the
// prompt as placeholders, and the reply's refs are resolved back. Only the
// template and the extra context differ.
async function openingCall(
  templateId: TemplateId,
  guidance: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
  extra?: Record<string, unknown>,
): Promise<GenerateStructuredResult<OpeningAssistValue>> {
  const idMap = new IdBiMap()
  const result = await generateFromState(
    templateId,
    openingOutputSchema,
    guidance,
    idMap,
    signal,
    deps,
    extra,
  )
  if (result.status !== 'ok') return result
  return { status: 'ok', value: resolveOpening(result.value, idMap, deps) }
}

export function runOpeningAssist(
  guidance: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
): Promise<GenerateStructuredResult<OpeningAssistValue>> {
  return openingCall(TEMPLATE_IDS.wizardOpening, guidance, signal, deps)
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

/**
 * @param suggested Titles already on screen from earlier pages. Excluded
 * alongside the committed rows so `Generate more` sends a prompt that differs
 * from the one that produced them, instead of re-rolling and being deduped.
 */
export function runLoreAssist(
  guidance: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
  suggested: readonly string[] = [],
): Promise<GenerateStructuredResult<LoreAssistValue>> {
  return generateFromState(
    TEMPLATE_IDS.wizardLore,
    loreSuggestionsSchema,
    guidance,
    new IdBiMap(),
    signal,
    deps,
    { suggested: [...suggested] },
  )
}

/**
 * @param suggested Names already on screen from earlier pages — excluded
 * alongside the authored cast so `Generate more` is additive (same contract
 * as runLoreAssist).
 */
export function runCastAssist(
  guidance: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
  suggested: readonly string[] = [],
): Promise<GenerateStructuredResult<CastAssistValue>> {
  return generateFromState(
    TEMPLATE_IDS.wizardCast,
    castSuggestionsSchema,
    guidance,
    new IdBiMap(),
    signal,
    deps,
    { suggested: [...suggested] },
  )
}

// Cumulative refine (wizard.md → Refine): the CURRENT preview is the input, so
// repeated refines compound rather than re-rolling from the base state. Each
// pass renders its own refine template with `current` + `instruction` as real
// context variables — no guidance, which belongs to a generate.
export function refineOpeningAssist(
  current: OpeningAssistValue,
  instruction: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
): Promise<GenerateStructuredResult<OpeningAssistValue>> {
  return openingCall(TEMPLATE_IDS.wizardOpeningRefine, '', signal, deps, { current, instruction })
}

export function refineDescriptionAssist(
  current: DescriptionAssistValue,
  instruction: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
): Promise<GenerateStructuredResult<DescriptionAssistValue>> {
  return generateFromState(
    TEMPLATE_IDS.wizardDescriptionRefine,
    descriptionOutputSchema,
    '',
    new IdBiMap(),
    signal,
    deps,
    { current, instruction },
  )
}

export function runGenreAssist(
  guidance: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
): Promise<GenerateStructuredResult<GenreAssistValue>> {
  return generateFromState(
    TEMPLATE_IDS.wizardGenre,
    labeledPromptOutputSchema,
    guidance,
    new IdBiMap(),
    signal,
    deps,
  )
}

export function runToneAssist(
  guidance: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
): Promise<GenerateStructuredResult<ToneAssistValue>> {
  return generateFromState(
    TEMPLATE_IDS.wizardTone,
    labeledPromptOutputSchema,
    guidance,
    new IdBiMap(),
    signal,
    deps,
  )
}

export function runSettingAssist(
  guidance: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
): Promise<GenerateStructuredResult<SettingAssistValue>> {
  return generateFromState(
    TEMPLATE_IDS.wizardSetting,
    settingOutputSchema,
    guidance,
    new IdBiMap(),
    signal,
    deps,
  )
}

export function refineGenreAssist(
  current: GenreAssistValue,
  instruction: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
): Promise<GenerateStructuredResult<GenreAssistValue>> {
  return generateFromState(
    TEMPLATE_IDS.wizardGenreRefine,
    labeledPromptOutputSchema,
    '',
    new IdBiMap(),
    signal,
    deps,
    { current, instruction },
  )
}

export function refineToneAssist(
  current: ToneAssistValue,
  instruction: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
): Promise<GenerateStructuredResult<ToneAssistValue>> {
  return generateFromState(
    TEMPLATE_IDS.wizardToneRefine,
    labeledPromptOutputSchema,
    '',
    new IdBiMap(),
    signal,
    deps,
    { current, instruction },
  )
}

export function refineSettingAssist(
  current: SettingAssistValue,
  instruction: string,
  signal: AbortSignal,
  deps?: WizardAssistDeps,
): Promise<GenerateStructuredResult<SettingAssistValue>> {
  return generateFromState(
    TEMPLATE_IDS.wizardSettingRefine,
    settingOutputSchema,
    '',
    new IdBiMap(),
    signal,
    deps,
    { current, instruction },
  )
}
