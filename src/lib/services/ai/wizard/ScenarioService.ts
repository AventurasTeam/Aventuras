/**
 * Scenario Service
 *
 * Provides AI-powered scenario generation for the story wizard.
 *
 * STATUS: STUBBED - Awaiting SDK migration
 * All generation methods throw errors. Non-LLM utility methods preserved.
 */

import { settings, getPresetDefaults } from '$lib/stores/settings.svelte'
import type { ProviderType } from '$lib/types'
import type { ReasoningEffort } from '$lib/types'
import type { StoryMode, POV, Character, Location, Item } from '$lib/types'
import { ContextBuilder } from '$lib/services/context'
import { createLogger } from '../core/config'
import {
  type ExpandedSetting,
  type GeneratedProtagonist,
  type GeneratedCharacter,
  type GeneratedOpening,
  expandedSettingSchema,
  generatedProtagonistSchema,
  generatedCharactersSchema,
  generatedOpeningSchema,
} from '$lib/services/ai/sdk/schemas/scenario'
import { generateStructured } from '$lib/services/ai/sdk'

const log = createLogger('ScenarioService')

// Default model for scenario generation - fast and capable
export const SCENARIO_MODEL = 'deepseek/deepseek-v3.2'

// Provider preference - prioritize Deepseek with fallbacks, require all parameters
export const SCENARIO_PROVIDER = { order: ['deepseek'], require_parameters: false }

export type Genre = 'fantasy' | 'scifi' | 'modern' | 'horror' | 'mystery' | 'romance' | 'custom'
export type Tense = 'past' | 'present'

// Advanced settings for customizing generation processes
export interface ProcessSettings {
  profileId?: string | null
  presetId?: string
  model?: string
  temperature?: number
  topP?: number
  maxTokens?: number
  reasoningEffort?: ReasoningEffort
  manualBody?: string
}

export interface AdvancedWizardSettings {
  settingExpansion: ProcessSettings
  settingRefinement: ProcessSettings
  protagonistGeneration: ProcessSettings
  characterElaboration: ProcessSettings
  characterRefinement: ProcessSettings
  supportingCharacters: ProcessSettings
  openingGeneration: ProcessSettings
  openingRefinement: ProcessSettings
}

export function getDefaultAdvancedSettings(): AdvancedWizardSettings {
  return getDefaultAdvancedSettingsForProvider('openrouter')
}

export function getDefaultAdvancedSettingsForProvider(
  provider: ProviderType,
): AdvancedWizardSettings {
  const preset = getPresetDefaults(provider, 'wizard')

  return {
    settingExpansion: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
    settingRefinement: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
    protagonistGeneration: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
    characterElaboration: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
    characterRefinement: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
    supportingCharacters: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
    openingGeneration: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
    openingRefinement: {
      presetId: 'wizard',
      profileId: null,
      model: preset.model,
      temperature: 0.3,
      topP: 0.95,
      maxTokens: 8192,
      reasoningEffort: preset.reasoningEffort,
      manualBody: '',
    },
  }
}

export interface WizardData {
  mode: StoryMode
  genre: Genre
  customGenre?: string
  settingSeed: string
  expandedSetting?: ExpandedSetting
  protagonist?: GeneratedProtagonist
  characters?: GeneratedCharacter[]
  writingStyle: {
    pov: POV
    tense: Tense
    tone: string
    visualProseMode?: boolean
    imageGenerationMode?: 'none' | 'agentic' | 'inline'
    backgroundImagesEnabled?: boolean
    referenceMode?: boolean
  }
  title: string
  openingGuidance?: string
}

class ScenarioService {
  /**
   * Expand a user's seed prompt into a full setting description.
   * @throws Error - Service not implemented during SDK migration
   */
  async expandSetting(
    seed: string,
    genre: Genre,
    customGenre?: string,
    presetId?: string,
    lorebookEntries?: { name: string; type: string; description: string; hiddenInfo?: string }[],
    customInstruction?: string,
  ): Promise<ExpandedSetting> {
    log('expandSetting called', {
      seed,
      genre,
      customGenre,
      presetId,
      lorebookEntryCount: lorebookEntries?.length ?? 0,
      hasCustomInstructions: !!customInstruction,
    })

    const presetConfig = settings.getPresetConfig(presetId || '', 'Setting Expansion')
    const genreLabel = genre === 'custom' && customGenre ? customGenre : genre

    const customInstructionBlock = customInstruction?.trim()
      ? `\n\nAUTHOR'S GUIDANCE: ${customInstruction.trim()}`
      : ''
    const lorebookContext = this.buildSettingLorebookContext(lorebookEntries)

    const ctx = new ContextBuilder()
    ctx.add({ genreLabel, seed, lorebookContext, customInstruction: customInstructionBlock })
    const { system, user: prompt } = await ctx.render('setting-expansion')

    const result = await generateStructured(
      {
        presetId: presetConfig.id,
        schema: expandedSettingSchema,
        system,
        prompt,
      },
      'setting-expansion',
    )

    log('expandSetting complete')

    return result
  }

  /**
   * Refine an existing setting using the current expanded data.
   * @throws Error - Service not implemented during SDK migration
   */
  async refineSetting(
    currentSetting: ExpandedSetting,
    genre: Genre,
    customGenre?: string,
    presetId?: string,
    lorebookEntries?: { name: string; type: string; description: string; hiddenInfo?: string }[],
    customInstruction?: string,
  ): Promise<ExpandedSetting> {
    log('refineSetting called', {
      genre,
      customGenre,
      presetId,
      lorebookEntryCount: lorebookEntries?.length ?? 0,
      hasCustomInstructions: !!customInstruction,
    })

    const presetConfig = settings.getPresetConfig(presetId || '', 'Setting Refinement')
    const genreLabel = genre === 'custom' && customGenre ? customGenre : genre

    const customInstructionBlock = customInstruction?.trim()
      ? `\n\nAUTHOR'S GUIDANCE: ${customInstruction.trim()}`
      : ''

    const keyLocations = currentSetting.keyLocations ?? []
    const themes = currentSetting.themes ?? []
    const potentialConflicts = currentSetting.potentialConflicts ?? []
    const keyLocationsBlock =
      keyLocations.length > 0
        ? keyLocations.map((location) => `- ${location.name}: ${location.description}`).join('\n')
        : '- (none)'

    const currentSettingBlock = [
      `NAME: ${currentSetting.name}`,
      `DESCRIPTION: ${currentSetting.description}`,
      `ATMOSPHERE: ${currentSetting.atmosphere || '(none)'}`,
      `THEMES: ${themes.length > 0 ? themes.join(', ') : '(none)'}`,
      `POTENTIAL CONFLICTS: ${potentialConflicts.length > 0 ? potentialConflicts.join(', ') : '(none)'}`,
      `KEY LOCATIONS:\n${keyLocationsBlock}`,
    ].join('\n')

    const lorebookContext = this.buildSettingLorebookContext(lorebookEntries)

    const ctx = new ContextBuilder()
    ctx.add({
      genreLabel,
      currentSetting: currentSettingBlock,
      lorebookContext,
      customInstruction: customInstructionBlock,
    })
    const { system, user: prompt } = await ctx.render('setting-refinement')

    const result = await generateStructured(
      {
        presetId: presetConfig.id,
        schema: expandedSettingSchema,
        system,
        prompt,
      },
      'setting-refinement',
    )

    log('refineSetting complete')

    return result
  }

  /**
   * Elaborate on user-provided character details using AI.
   * @throws Error - Service not implemented during SDK migration
   */
  async elaborateCharacter(
    userInput: {
      name?: string
      description?: string
      background?: string
      motivation?: string
      traits?: string[]
    },
    setting: ExpandedSetting | null,
    genre: Genre,
    customGenre?: string,
    presetId?: string,
    customInstruction?: string,
  ): Promise<GeneratedProtagonist> {
    log('elaborateCharacter called', {
      userInput,
      genre,
      presetId,
      hasCustomInstruction: !!customInstruction,
    })

    const presetConfig = settings.getPresetConfig(presetId || '', 'Character Elaboration')
    const genreLabel = genre === 'custom' && customGenre ? customGenre : genre

    const toneInstruction = `- Keep the tone appropriate for the ${genreLabel} genre`
    const settingInstruction = setting
      ? `- Make the character fit naturally into: ${setting.name}`
      : ''
    const customInstructionBlock = customInstruction?.trim()
      ? `\n\nAUTHOR'S GUIDANCE: ${customInstruction.trim()}`
      : ''

    const characterName = userInput.name ? `NAME: ${userInput.name}` : 'NAME: (suggest one)'
    const characterDescription = userInput.description
      ? `DESCRIPTION: ${userInput.description}`
      : ''
    const characterBackgroundParts: string[] = []
    if (userInput.background) characterBackgroundParts.push(`BACKGROUND: ${userInput.background}`)
    if (userInput.motivation) characterBackgroundParts.push(`MOTIVATION: ${userInput.motivation}`)
    if (userInput.traits && userInput.traits.length > 0) {
      characterBackgroundParts.push(`TRAITS: ${userInput.traits.join(', ')}`)
    }
    const characterBackground = characterBackgroundParts.join('\n')
    const settingContext = setting ? `SETTING: ${setting.name}\n${setting.description}` : ''

    const ctx = new ContextBuilder()
    ctx.add({
      genreLabel,
      toneInstruction,
      settingInstruction,
      customInstruction: customInstructionBlock,
      characterName,
      characterDescription,
      characterBackground,
      settingContext,
    })
    const { system, user: prompt } = await ctx.render('character-elaboration')

    const result = await generateStructured(
      {
        presetId: presetConfig.id,
        schema: generatedProtagonistSchema,
        system,
        prompt,
      },
      'character-elaboration',
    )

    log('elaborateCharacter complete')

    return result
  }

  /**
   * Refine an existing character using the current expanded data.
   * @throws Error - Service not implemented during SDK migration
   */
  async refineCharacter(
    currentCharacter: GeneratedProtagonist,
    setting: ExpandedSetting | null,
    genre: Genre,
    customGenre?: string,
    presetId?: string,
    customInstruction?: string,
  ): Promise<GeneratedProtagonist> {
    log('refineCharacter called', {
      characterName: currentCharacter.name,
      genre,
      presetId,
      hasCustomInstruction: !!customInstruction,
    })

    const presetConfig = settings.getPresetConfig(presetId || '', 'Character Refinement')
    const genreLabel = genre === 'custom' && customGenre ? customGenre : genre

    const toneInstruction = `- Keep the tone appropriate for the ${genreLabel} genre`
    const settingInstruction = setting ? `- Make character fit naturally into: ${setting.name}` : ''
    const customInstructionBlock = customInstruction?.trim()
      ? `\n\nAUTHOR'S GUIDANCE: ${customInstruction.trim()}`
      : ''

    const traits = currentCharacter.traits ?? []
    const currentCharacterBlock = [
      `NAME: ${currentCharacter.name || '(suggest one)'}`,
      `DESCRIPTION: ${currentCharacter.description || '(none)'}`,
      `BACKGROUND: ${currentCharacter.background || '(none)'}`,
      `MOTIVATION: ${currentCharacter.motivation || '(none)'}`,
      `TRAITS: ${traits.length > 0 ? traits.join(', ') : '(none)'}`,
      `APPEARANCE: ${currentCharacter.appearance || '(none)'}`,
    ].join('\n')

    const settingContext = setting ? `SETTING: ${setting.name}\n${setting.description}` : ''

    const ctx = new ContextBuilder()
    ctx.add({
      genreLabel,
      toneInstruction,
      settingInstruction,
      customInstruction: customInstructionBlock,
      currentCharacter: currentCharacterBlock,
      settingContext,
    })
    const { system, user: prompt } = await ctx.render('character-refinement')

    const result = await generateStructured(
      {
        presetId: presetConfig.id,
        schema: generatedProtagonistSchema,
        system,
        prompt,
      },
      'character-refinement',
    )

    log('refineCharacter complete')

    return result
  }

  /**
   * Generate a protagonist character based on setting and mode.
   * @throws Error - Service not implemented during SDK migration
   */
  async generateProtagonist(
    setting: ExpandedSetting,
    genre: Genre,
    mode: StoryMode,
    pov: POV,
    customGenre?: string,
    presetId?: string,
  ): Promise<GeneratedProtagonist> {
    log('generateProtagonist called', { settingName: setting.name, genre, mode, pov, presetId })

    const presetConfig = settings.getPresetConfig(presetId || '', 'Protagonist Generation')
    const genreLabel = genre === 'custom' && customGenre ? customGenre : genre

    const povContext =
      pov === 'first'
        ? 'The reader will be this character, narrated in first person (I...).'
        : pov === 'second'
          ? 'The reader will be this character, narrated in second person (You...).'
          : 'This is the main viewpoint character for a third person narrative.'

    const modeContext =
      mode === 'adventure'
        ? 'This is for an interactive adventure where, reader makes choices as this character.'
        : 'This is for a creative writing project where this character drives the narrative.'

    const povInstruction = `${povContext}\n${modeContext}`
    const settingDescription = `${setting.description}\n\nATMOSPHERE: ${setting.atmosphere}\n\nTHEMES: ${setting.themes.join(', ')}`

    const ctx = new ContextBuilder()
    ctx.add({
      mode,
      pov,
      genreLabel,
      settingName: setting.name,
      settingDescription,
      povInstruction,
    })
    const { system, user: prompt } = await ctx.render('protagonist-generation')

    const result = await generateStructured(
      {
        presetId: presetConfig.id,
        schema: generatedProtagonistSchema,
        system,
        prompt,
      },
      'protagonist-generation',
    )

    log('generateProtagonist complete')

    return result
  }

  /**
   * Generate supporting characters for creative writing mode.
   * @throws Error - Service not implemented during SDK migration
   */
  async generateCharacters(
    setting: ExpandedSetting,
    protagonist: GeneratedProtagonist,
    genre: Genre,
    count: number = 3,
    customGenre?: string,
    presetId?: string,
  ): Promise<GeneratedCharacter[]> {
    log('generateCharacters called', { settingName: setting.name, count, presetId })

    const presetConfig = settings.getPresetConfig(presetId || '', 'Supporting Characters')
    const genreLabel = genre === 'custom' && customGenre ? customGenre : genre

    const ctx = new ContextBuilder()
    ctx.add({
      count,
      genreLabel,
      settingName: setting.name,
      settingDescription: setting.description,
      protagonistName: protagonist.name,
      protagonistDescription: `${protagonist.description}\nMotivation: ${protagonist.motivation}`,
    })
    const { system, user: prompt } = await ctx.render('supporting-characters')

    const result = await generateStructured(
      {
        presetId: presetConfig.id,
        schema: generatedCharactersSchema,
        system,
        prompt,
      },
      'supporting-characters',
    )

    log('generateCharacters complete')

    return result
  }

  /**
   * Generate an opening scene based on all of setup data.
   * @throws Error - Service not implemented during SDK migration
   */
  async generateOpening(
    wizardData: WizardData,
    presetId?: string,
    lorebookEntries?: { name: string; type: string; description: string; hiddenInfo?: string }[],
  ): Promise<GeneratedOpening> {
    log('generateOpening called', {
      settingName: wizardData.expandedSetting?.name,
      protagonist: wizardData.protagonist?.name,
      mode: wizardData.mode,
      presetId,
      lorebookEntries: lorebookEntries?.length ?? 0,
    })

    const presetConfig = settings.getPresetConfig(presetId || '', 'Opening Generation')
    const { system, prompt, templateId } = await this.buildOpeningPrompts(
      wizardData,
      lorebookEntries,
      'json',
    )

    const result = await generateStructured(
      {
        presetId: presetConfig.id,
        schema: generatedOpeningSchema,
        system,
        prompt,
      },
      templateId,
    )

    log('generateOpening complete')

    return result
  }

  /**
   * Refine an existing opening scene based on current setup data.
   * @throws Error - Service not implemented during SDK migration
   */
  async refineOpening(
    wizardData: WizardData,
    currentOpening: GeneratedOpening,
    presetId?: string,
    lorebookEntries?: { name: string; type: string; description: string; hiddenInfo?: string }[],
  ): Promise<GeneratedOpening> {
    log('refineOpening called', {
      title: currentOpening.title,
      mode: wizardData.mode,
      presetId,
      lorebookEntries: lorebookEntries?.length ?? 0,
    })

    const presetConfig = settings.getPresetConfig(presetId || '', 'Opening Refinement')
    const { system, prompt, templateId } = await this.buildOpeningRefinementPrompts(
      wizardData,
      currentOpening,
      lorebookEntries,
      'json',
    )

    const result = await generateStructured(
      {
        presetId: presetConfig.id,
        schema: generatedOpeningSchema,
        system,
        prompt,
      },
      templateId,
    )

    log('refineOpening complete')

    return result
  }

  private async buildOpeningPrompts(
    wizardData: WizardData,
    lorebookEntries?: { name: string; type: string; description: string; hiddenInfo?: string }[],
    outputMode: 'json' | 'stream' = 'json',
  ): Promise<{ system: string; prompt: string; templateId: string }> {
    const {
      mode,
      genre,
      customGenre,
      expandedSetting,
      protagonist,
      characters,
      writingStyle,
      title,
    } = wizardData
    const genreLabel = genre === 'custom' && customGenre ? customGenre : genre
    const protagonistName = protagonist?.name || 'the protagonist'
    const templateId =
      mode === 'creative-writing' ? 'opening-generation-creative' : 'opening-generation-adventure'

    const tenseInstruction =
      writingStyle.tense === 'present' ? 'Use present tense.' : 'Use past tense.'

    const tone = writingStyle.tone || 'immersive and engaging'
    const outputFormat = this.getOpeningOutputFormat(
      mode,
      protagonistName,
      outputMode,
      writingStyle.pov,
    )
    const povInfo = this.getOpeningPovInstruction(writingStyle.pov, protagonistName)

    const atmosphereSection = expandedSetting?.atmosphere
      ? `ATMOSPHERE: ${expandedSetting.atmosphere}`
      : ''
    const protagonistDescription = protagonist?.description ? `\n${protagonist.description}` : ''
    const supportingCharactersSection =
      characters && characters.length > 0
        ? `NPCs WHO MAY APPEAR:\n${characters.map((c) => `- ${c.name} (${c.role}): ${c.description}`).join('\n')}\n`
        : ''
    const guidanceSection = wizardData.openingGuidance?.trim()
      ? `\nAUTHOR'S GUIDANCE FOR OPENING:\n${wizardData.openingGuidance.trim()}\n`
      : ''
    const lorebookContext = this.buildOpeningLorebookContext(lorebookEntries)
    const openingInstruction =
      mode === 'creative-writing'
        ? ''
        : `\nDescribe the environment and situation. Do NOT write anything ${protagonistName} does, says, thinks, or perceives. End with a moment that invites action.`

    const ctx = new ContextBuilder()
    ctx.add({
      genreLabel,
      mode,
      tenseInstruction,
      tone,
      outputFormat,
      protagonistName,
      protagonistDescription,
      title: title || '(suggest one)',
      settingName: expandedSetting?.name || 'Unknown World',
      settingDescription: expandedSetting?.description || wizardData.settingSeed,
      atmosphereSection,
      supportingCharactersSection,
      povInstruction: povInfo.instruction,
      povPerspective: povInfo.perspective,
      povPerspectiveInstructions: povInfo.perspectiveInstructions,
      guidanceSection,
      lorebookContext,
      openingInstruction,
    })
    const { system, user: prompt } = await ctx.render(templateId)

    return { system, prompt, templateId }
  }

  private async buildOpeningRefinementPrompts(
    wizardData: WizardData,
    currentOpening: GeneratedOpening,
    lorebookEntries?: { name: string; type: string; description: string; hiddenInfo?: string }[],
    outputMode: 'json' | 'stream' = 'json',
  ): Promise<{ system: string; prompt: string; templateId: string }> {
    const {
      mode,
      genre,
      customGenre,
      expandedSetting,
      protagonist,
      characters,
      writingStyle,
      title,
    } = wizardData
    const genreLabel = genre === 'custom' && customGenre ? customGenre : genre
    const protagonistName = protagonist?.name || 'the protagonist'
    const templateId =
      mode === 'creative-writing' ? 'opening-refinement-creative' : 'opening-refinement-adventure'

    const tenseInstruction =
      writingStyle.tense === 'present' ? 'Use present tense.' : 'Use past tense.'

    const tone = writingStyle.tone || 'immersive and engaging'
    const outputFormat = this.getOpeningOutputFormat(
      mode,
      protagonistName,
      outputMode,
      writingStyle.pov,
    )
    const povInfo = this.getOpeningPovInstruction(writingStyle.pov, protagonistName)

    const atmosphereSection = expandedSetting?.atmosphere
      ? `ATMOSPHERE: ${expandedSetting.atmosphere}`
      : ''
    const protagonistDescription = protagonist?.description ? `\n${protagonist.description}` : ''
    const supportingCharactersSection =
      characters && characters.length > 0
        ? `NPCs WHO MAY APPEAR:\n${characters.map((c) => `- ${c.name} (${c.role}): ${c.description}`).join('\n')}\n`
        : ''
    const guidanceSection = wizardData.openingGuidance?.trim()
      ? `\nAUTHOR'S GUIDANCE FOR OPENING:\n${wizardData.openingGuidance.trim()}\n`
      : ''
    const lorebookContext = this.buildOpeningLorebookContext(lorebookEntries)
    const openingInstruction =
      mode === 'creative-writing'
        ? ''
        : `\nDescribe the environment and situation. Do NOT write anything ${protagonistName} does, says, thinks, or perceives. End with a moment that invites action.`

    const locationSummary = currentOpening.initialLocation?.description
      ? `${currentOpening.initialLocation.name} - ${currentOpening.initialLocation.description}`
      : currentOpening.initialLocation?.name || 'Starting Location'
    const currentOpeningBlock = [
      `TITLE: ${currentOpening.title || title || '(suggest one)'}`,
      `LOCATION: ${locationSummary}`,
      'SCENE:',
      currentOpening.scene,
    ].join('\n')

    const ctx = new ContextBuilder()
    ctx.add({
      genreLabel,
      mode,
      tenseInstruction,
      tone,
      outputFormat,
      protagonistName,
      protagonistDescription,
      title: title || currentOpening.title || '(suggest one)',
      settingName: expandedSetting?.name || 'Unknown World',
      settingDescription: expandedSetting?.description || wizardData.settingSeed,
      atmosphereSection,
      supportingCharactersSection,
      povInstruction: povInfo.instruction,
      povPerspective: povInfo.perspective,
      povPerspectiveInstructions: povInfo.perspectiveInstructions,
      guidanceSection,
      lorebookContext,
      openingInstruction,
      currentOpening: currentOpeningBlock,
    })
    const { system, user: prompt } = await ctx.render(templateId)

    return { system, prompt, templateId }
  }

  private buildOpeningLorebookContext(
    lorebookEntries?: { name: string; type: string; description: string; hiddenInfo?: string }[],
  ): string {
    if (!lorebookEntries || lorebookEntries.length === 0) return ''

    const entriesByType: Record<
      string,
      { name: string; description: string; hiddenInfo?: string }[]
    > = {}
    for (const entry of lorebookEntries) {
      if (!entriesByType[entry.type]) {
        entriesByType[entry.type] = []
      }
      entriesByType[entry.type].push({
        name: entry.name,
        description: entry.description,
        hiddenInfo: entry.hiddenInfo,
      })
    }

    let lorebookContext =
      '\n\n## LOREBOOK (Established Canon)\nThe opening scene MUST be consistent with this established lore:\n'
    for (const [type, entries] of Object.entries(entriesByType)) {
      if (entries.length > 0) {
        lorebookContext += `\n### ${type.charAt(0).toUpperCase() + type.slice(1)}s:\n`
        for (const entry of entries) {
          lorebookContext += `- **${entry.name}**: ${entry.description}`
          if (entry.hiddenInfo) {
            lorebookContext += ` [Hidden lore: ${entry.hiddenInfo}]`
          }
          lorebookContext += '\n'
        }
      }
    }

    return lorebookContext
  }

  private getOpeningPovInstruction(
    pov: POV,
    protagonistName: string = 'the protagonist',
  ): { instruction: string; perspective: string; perspectiveInstructions: string } {
    switch (pov) {
      case 'first':
        return {
          instruction: 'POV: First person (I/me/my).',
          perspective: 'the protagonist\'s first-person perspective ("I see...", "I feel...")',
          perspectiveInstructions:
            'Use "I/me/my" for the protagonist. Write from their internal perspective.',
        }
      case 'second':
        return {
          instruction: 'POV: Second person (You/your).',
          perspective: 'the protagonist\'s second-person perspective ("You see...", "You feel...")',
          perspectiveInstructions:
            'Use "you/your" for the protagonist. Address the reader/protagonist directly.',
        }
      case 'third':
      default:
        return {
          instruction: 'POV: Third person (he/she/they).',
          perspective: `through ${protagonistName}'s perspective`,
          perspectiveInstructions: `NEVER use second person ("you"). Always use "${protagonistName}" or "he/she/they".`,
        }
    }
  }

  private getOpeningOutputFormat(
    mode: StoryMode,
    protagonistName: string,
    outputMode: 'json' | 'stream',
    pov?: POV,
  ): string {
    if (outputMode === 'stream') {
      return 'Write ONLY prose. No JSON, no metadata.'
    }

    let sceneInstruction: string
    if (mode === 'creative-writing') {
      switch (pov) {
        case 'first':
          sceneInstruction = `string - the opening (2-3 paragraphs of first-person narrative featuring ${protagonistName})`
          break
        case 'second':
          sceneInstruction = `string - the opening (2-3 paragraphs of second-person narrative featuring ${protagonistName})`
          break
        case 'third':
        default:
          sceneInstruction = `string - the opening (2-3 paragraphs of third-person narrative featuring ${protagonistName})`
          break
      }
    } else {
      sceneInstruction = `string - the opening (2-3 paragraphs describing environment/situation, NOT ${protagonistName}'s actions)`
    }

    return `Respond with valid JSON:
{
  "scene": "${sceneInstruction}",
  "title": "string - story title",
  "initialLocation": {
    "name": "string - location name",
    "description": "string - 1-2 sentences"
  }
}`
  }

  /**
   * Convert wizard data to story creation parameters.
   * NOTE: This method works - it's just data transformation.
   */
  async prepareStoryData(
    wizardData: WizardData,
    opening: GeneratedOpening,
  ): Promise<{
    title: string
    genre: string
    description?: string
    mode: StoryMode
    settings: {
      pov: POV
      tense: Tense
      tone?: string
      themes?: string[]
      visualProseMode?: boolean
      inlineImageMode?: boolean
      imageGenerationMode?: 'none' | 'agentic' | 'inline'
      backgroundImagesEnabled?: boolean
      referenceMode?: boolean
    }
    protagonist: Partial<Character>
    startingLocation: Partial<Location>
    initialItems: Partial<Item>[]
    openingScene: string
    characters: Partial<Character>[]
  }> {
    const { mode, genre, customGenre, expandedSetting, protagonist, characters, writingStyle } =
      wizardData
    const genreLabel = genre === 'custom' && customGenre ? customGenre : this.capitalizeGenre(genre)

    return {
      title: opening.title || wizardData.title,
      genre: genreLabel,
      description: expandedSetting?.description,
      mode,
      settings: {
        pov: writingStyle.pov,
        tense: writingStyle.tense,
        tone: writingStyle.tone,
        themes: expandedSetting?.themes,
        visualProseMode: writingStyle.visualProseMode,
        imageGenerationMode: writingStyle.imageGenerationMode,
        backgroundImagesEnabled: writingStyle.backgroundImagesEnabled,
        referenceMode: writingStyle.referenceMode,
      },
      protagonist: {
        name: protagonist?.name || (writingStyle.pov === 'second' ? 'You' : 'The Protagonist'),
        description: protagonist?.description,
        relationship: 'self',
        traits: protagonist?.traits || [],
        status: 'active',
      },
      startingLocation: {
        name: opening.initialLocation.name,
        description: opening.initialLocation.description,
        visited: true,
        current: true,
        connections: [],
      },
      initialItems: [],
      openingScene: opening.scene,
      characters: (characters || []).map((c) => ({
        name: c.name,
        description: c.description,
        relationship: c.relationship,
        traits: c.traits,
        status: 'active' as const,
      })),
    }
  }

  private capitalizeGenre(genre: Genre): string {
    const genreMap: Record<Genre, string> = {
      fantasy: 'Fantasy',
      scifi: 'Sci-Fi',
      modern: 'Modern',
      horror: 'Horror',
      mystery: 'Mystery',
      romance: 'Romance',
      custom: 'Custom',
    }
    return genreMap[genre] || genre
  }

  private buildSettingLorebookContext(
    lorebookEntries?: { name: string; type: string; description: string; hiddenInfo?: string }[],
  ): string {
    if (!lorebookEntries || lorebookEntries.length === 0) return ''

    const entriesByType: Record<
      string,
      { name: string; description: string; hiddenInfo?: string }[]
    > = {}
    for (const entry of lorebookEntries) {
      if (!entriesByType[entry.type]) {
        entriesByType[entry.type] = []
      }
      entriesByType[entry.type].push({
        name: entry.name,
        description: entry.description,
        hiddenInfo: entry.hiddenInfo,
      })
    }

    let lorebookContext =
      '\n\n## Existing Lore (from imported lorebook)\nThese are established canon elements. The expanded setting MUST be consistent with all of this lore:\n'
    for (const [type, entries] of Object.entries(entriesByType)) {
      if (entries.length > 0) {
        lorebookContext += `\n### ${type.charAt(0).toUpperCase() + type.slice(1)}s:\n`
        for (const entry of entries) {
          lorebookContext += `- **${entry.name}**: ${entry.description}`
          if (entry.hiddenInfo) {
            lorebookContext += ` [Hidden lore: ${entry.hiddenInfo}]`
          }
          lorebookContext += '\n'
        }
      }
    }
    lorebookContext +=
      '\nMake sure the setting is consistent with the existing lore provided above.'

    return lorebookContext
  }
}

export const scenarioService = new ScenarioService()
