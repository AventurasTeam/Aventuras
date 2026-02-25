import { story } from '$lib/stores/story.svelte'
import { ui } from '$lib/stores/ui.svelte'
import { settings } from '$lib/stores/settings.svelte'
import { aiService } from '$lib/services/ai'
import {
  type ExpandedSetting,
  type GeneratedCharacter,
} from '$lib/services/ai/sdk/schemas/scenario'
import { scenarioService, type WizardData } from '$lib/services/ai/wizard/ScenarioService'
import { TranslationService } from '$lib/services/ai/utils/TranslationService'
import { QUICK_START_SEEDS } from '$lib/services/templates'
import { replaceUserPlaceholders } from '$lib/components/wizard/wizardTypes'
import type { VaultScenario } from '$lib/types'
import { lorebookVault } from '$lib/stores/lorebookVault.svelte'
import { stringToDescriptors } from '$lib/utils/visualDescriptors'
import { packService } from '$lib/services/packs/pack-service'
import { database } from '$lib/services/database'
import type { PresetPack, CustomVariable } from '$lib/services/packs/types'

// Import Modular Stores
import { NarrativeStore } from './narrativeStore.svelte'
import { SettingStore } from './settingStore.svelte'
import { CharacterStore } from './characterStore.svelte'
import { ImageStore } from './imageStore.svelte'
import { SvelteSet } from 'svelte/reactivity'

export class WizardStore {
  // Sub-stores
  narrative = new NarrativeStore()
  setting = new SettingStore()
  character = new CharacterStore()
  image = new ImageStore()

  // Wizard State
  currentStep = $state(1)
  totalSteps = 9

  // Pack selection state
  selectedPackId = $state<string>('default-pack')
  availablePacks = $state<PresetPack[]>([])
  packVariables = $state<CustomVariable[]>([])
  customVariableValues = $state<Record<string, string>>({})
  packsLoaded = $state(false)

  // Track auto-linked lorebook IDs so they can be removed when source is cleared
  private _scenarioLinkedLorebookVaultId = $state<string | null>(null)
  private _protagonistLinkedLorebookVaultId = $state<string | null>(null)

  onClose: () => void

  constructor(onClose: () => void) {
    this.onClose = onClose
  }

  // Navigation
  canProceed(): boolean {
    switch (this.currentStep) {
      case 1: // Mode
        return true
      case 2: // Pack Selection
        return this.allVariablesFilled()
      case 3: // World & Setting
        return this.setting.settingSeed.trim().length > 0
      case 4: // Character (required - must have protagonist)
        return this.character.protagonist !== null
      case 5: // Supporting Cast (optional)
        return true
      case 6: // Lorebook (optional)
        return true
      case 7: // Portraits (optional)
        return true
      case 8: // Writing Style
        return true
      case 9: // Opening
        return this.narrative.storyTitle.trim().length > 0
      default:
        return false
    }
  }

  nextStep() {
    if (this.currentStep < this.totalSteps && this.canProceed()) {
      this.currentStep++

      // Auto-scroll logic for scenario carousel is UI-side, but state trigger is here
      // We could use an effect in the component to watch currentStep
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--
    }
  }

  // Pack selection methods

  async loadPacks(): Promise<void> {
    if (this.packsLoaded) return
    this.availablePacks = await packService.getAllPacks()
    this.packsLoaded = true
    await this.loadPackVariables(this.selectedPackId)
  }

  async loadPackVariables(packId: string): Promise<void> {
    this.packVariables = await database.getPackVariables(packId)
    const newValues: Record<string, string> = {}
    for (const v of this.packVariables) {
      newValues[v.variableName] = v.defaultValue ?? ''
    }
    this.customVariableValues = newValues
  }

  async selectPack(packId: string): Promise<void> {
    this.selectedPackId = packId
    await this.loadPackVariables(packId)
  }

  setVariableValue(variableName: string, value: string): void {
    this.customVariableValues = { ...this.customVariableValues, [variableName]: value }
  }

  allVariablesFilled(): boolean {
    return this.packVariables.every((v) => {
      const val = this.customVariableValues[v.variableName]
      if (v.variableType === 'boolean') return true
      return val !== undefined && val !== ''
    })
  }

  // Orchestrations

  // Select Scenario (Cross-store)
  selectScenario(scenarioId: string) {
    const scenario = QUICK_START_SEEDS.find((s) => s.id === scenarioId)
    if (!scenario) return

    this.setting.selectedScenarioId = scenarioId

    // Narrative: Genre
    // Always set to 'custom' so that the text field (customGenre) is treated as the source of truth
    // for the genre label in scenarioService.
    this.narrative.selectedGenre = 'custom'
    this.narrative.customGenre = scenario.genre

    // Setting: Seed
    const locationDesc = scenario.initialState.startingLocation?.description
    if (locationDesc) {
      this.setting.settingSeed = locationDesc
      this.setting.useSettingAsIs()
    }

    // Character: Protagonist Manual Input
    const proto = scenario.initialState.protagonist
    if (proto) {
      this.character.manualCharacterName = proto.name ?? ''
      this.character.manualCharacterDescription = proto.description ?? ''
      // Type assertion needed as Character type doesn't have background/motivation directly
      this.character.manualCharacterBackground = (proto as any).background ?? ''
      this.character.manualCharacterMotivation = (proto as any).motivation ?? ''
      this.character.manualCharacterTraits = proto.traits?.join(', ') ?? ''
      this.character.showManualInput = true
      this.character.useManualCharacter()
    }
  }

  selectScenarioFromVault(scenario: VaultScenario) {
    // 1. Setting
    this.setting.settingSeed = scenario.settingSeed
    this.setting.expandedSetting = null
    this.setting.clearSettingEditState()

    // 2. NPCs (Character Store)
    const importedNpcs: GeneratedCharacter[] = scenario.npcs.map((npc) => ({
      name: npc.name,
      role: npc.role,
      description: npc.description,
      relationship: npc.relationship,
      traits: npc.traits || [],
    }))

    // Filter duplicates if any existing imported NPCs
    if (this.character.importedCardNpcs.length > 0) {
      const prevImportedNames = new SvelteSet(this.character.importedCardNpcs.map((n) => n.name))
      this.character.supportingCharacters = this.character.supportingCharacters.filter(
        (c) => !prevImportedNames.has(c.name),
      )
    }

    this.character.supportingCharacters = [...this.character.supportingCharacters, ...importedNpcs]
    this.character.importedCardNpcs = importedNpcs

    // 3. Title (Narrative Store)
    if (scenario.name) {
      this.character.cardImportedTitle = scenario.name
      this.narrative.storyTitle = scenario.name
    }

    // 4. Opening (Character/Narrative Store Integration)
    if (scenario.firstMessage) {
      this.character.cardImportedFirstMessage = scenario.firstMessage
      this.character.cardImportedAlternateGreetings = scenario.alternateGreetings || []
      this.character.selectedGreetingIndex = 0
    } else {
      this.character.cardImportedFirstMessage = null
      this.character.cardImportedAlternateGreetings = []
    }

    // 5. Auto-link embedded lorebook if available
    // Remove previously auto-linked scenario lorebook first
    if (this._scenarioLinkedLorebookVaultId) {
      this._removeLinkedLorebook(this._scenarioLinkedLorebookVaultId)
      this._scenarioLinkedLorebookVaultId = null
    }
    if (scenario.metadata?.linkedLorebookId) {
      const linkedId = scenario.metadata.linkedLorebookId as string
      const lorebook = lorebookVault.getById(linkedId)
      if (lorebook) {
        const alreadyAdded = this.narrative.importedLorebooks.some((lb) => lb.vaultId === linkedId)
        if (!alreadyAdded) {
          this.narrative.addLorebookFromVault(lorebook)
          ui.showToast(`Added embedded lorebook: ${lorebook.name}`, 'info')
        }
        this._scenarioLinkedLorebookVaultId = linkedId
      }
    }

    this.setting.showScenarioVaultPicker = false
    this.setting.useSettingAsIs()
  }

  /** Remove auto-linked lorebook by vault lorebook ID */
  _removeLinkedLorebook(lorebookVaultId: string) {
    const imported = this.narrative.importedLorebooks.find((lb) => lb.vaultId === lorebookVaultId)
    if (imported) {
      const name = lorebookVault.getById(lorebookVaultId)?.name ?? 'lorebook'
      this.narrative.removeLorebook(imported.id)
      ui.showToast(`Removed embedded lorebook: ${name}`, 'info')
    }
  }

  /** Clear scenario's auto-linked lorebook (called when clearing card import) */
  clearScenarioLinkedLorebook() {
    if (this._scenarioLinkedLorebookVaultId) {
      this._removeLinkedLorebook(this._scenarioLinkedLorebookVaultId)
      this._scenarioLinkedLorebookVaultId = null
    }
  }

  /** Track/untrack protagonist linked lorebook */
  setProtagonistLinkedLorebook(lorebookVaultId: string | null) {
    if (this._protagonistLinkedLorebookVaultId) {
      this._removeLinkedLorebook(this._protagonistLinkedLorebookVaultId)
    }
    this._protagonistLinkedLorebookVaultId = lorebookVaultId
  }

  // Wrapper for Generate Opening (Needs data from all stores)
  async generateOpeningScene() {
    const wizardData: WizardData = {
      mode: this.narrative.selectedMode,
      genre: this.narrative.selectedGenre,
      customGenre: this.narrative.customGenre || undefined,
      settingSeed: this.setting.settingSeed,
      expandedSetting: this.setting.expandedSetting || undefined,
      protagonist: this.character.protagonist || undefined,
      characters:
        this.character.supportingCharacters.length > 0
          ? this.character.supportingCharacters
          : undefined,
      writingStyle: {
        pov: this.narrative.selectedPOV,
        tense: this.narrative.selectedTense,
        tone: this.narrative.tone,
      },
      title: this.narrative.storyTitle,
      openingGuidance:
        this.narrative.selectedMode === 'creative-writing' && this.narrative.openingGuidance.trim()
          ? this.narrative.openingGuidance.trim()
          : undefined,
    }

    await this.narrative.generateOpeningScene(wizardData)
  }

  // Wrapper for Refine Opening
  async refineOpeningScene() {
    const wizardData: WizardData = {
      mode: this.narrative.selectedMode,
      genre: this.narrative.selectedGenre,
      customGenre: this.narrative.customGenre || undefined,
      settingSeed: this.setting.settingSeed,
      expandedSetting: this.setting.expandedSetting || undefined,
      protagonist: this.character.protagonist || undefined,
      characters:
        this.character.supportingCharacters.length > 0
          ? this.character.supportingCharacters
          : undefined,
      writingStyle: {
        pov: this.narrative.selectedPOV,
        tense: this.narrative.selectedTense,
        tone: this.narrative.tone,
      },
      title: this.narrative.storyTitle,
      openingGuidance:
        this.narrative.selectedMode === 'creative-writing' && this.narrative.openingGuidance.trim()
          ? this.narrative.openingGuidance.trim()
          : undefined,
    }

    await this.narrative.refineOpeningScene(wizardData)
  }

  // Create Story
  async createStory() {
    if (!this.narrative.storyTitle.trim()) return

    // Use manual opening if provided
    if (!this.narrative.generatedOpening && this.narrative.manualOpeningText.trim()) {
      this.narrative.generatedOpening = {
        scene: this.narrative.manualOpeningText.trim(),
        title: this.narrative.storyTitle || 'Untitled Story',
        initialLocation: {
          name: 'Starting Location',
          description: 'The place where your journey begins.',
        },
      }
    }

    // Use card imported opening if available
    if (!this.narrative.generatedOpening && this.character.cardImportedFirstMessage) {
      this.narrative.generatedOpening = {
        scene: this.character.cardImportedFirstMessage,
        title: this.character.cardImportedTitle || this.narrative.storyTitle || 'Untitled Story',
        initialLocation: {
          name: 'Starting Location',
          description: 'The place where your journey begins.',
        },
      }
    }

    if (!this.narrative.generatedOpening) {
      this.narrative.openingError =
        'Please provide an opening scene (write your own or generate with AI)'
      return
    }

    const protagonistName = this.character.protagonist?.name || 'the protagonist'

    const processedSettingSeed = replaceUserPlaceholders(this.setting.settingSeed, protagonistName)

    let processedExpandedSetting: ExpandedSetting | null = null
    if (this.setting.expandedSetting) {
      processedExpandedSetting = {
        ...this.setting.expandedSetting,
        description: replaceUserPlaceholders(
          this.setting.expandedSetting.description,
          protagonistName,
        ),
        keyLocations: this.setting.expandedSetting.keyLocations.map((l) => ({
          ...l,
          description: replaceUserPlaceholders(l.description, protagonistName),
        })),
        atmosphere: replaceUserPlaceholders(
          this.setting.expandedSetting.atmosphere,
          protagonistName,
        ),
        themes: this.setting.expandedSetting.themes.map((t) =>
          replaceUserPlaceholders(t, protagonistName),
        ),
        potentialConflicts: this.setting.expandedSetting.potentialConflicts.map((c) =>
          replaceUserPlaceholders(c, protagonistName),
        ),
      }
    }

    const processedOpening = {
      ...this.narrative.generatedOpening,
      scene: replaceUserPlaceholders(this.narrative.generatedOpening.scene, protagonistName),
    }

    const processedCharacters = this.character.supportingCharacters.map((char) => ({
      ...char,
      name: replaceUserPlaceholders(char.name, protagonistName),
      description: replaceUserPlaceholders(char.description, protagonistName),
      role: char.role ? replaceUserPlaceholders(char.role, protagonistName) : '',
      relationship: char.relationship
        ? replaceUserPlaceholders(char.relationship, protagonistName)
        : '',
      traits: char.traits.map((t) => replaceUserPlaceholders(t, protagonistName)),
    }))

    const processedEntries = this.narrative.importedEntries.map((e) => ({
      ...e,
      name: replaceUserPlaceholders(e.name, protagonistName),
      description: replaceUserPlaceholders(e.description, protagonistName),
      keywords: e.keywords.map((k) => replaceUserPlaceholders(k, protagonistName)),
    }))

    const wizardData: WizardData = {
      mode: this.narrative.selectedMode,
      genre: this.narrative.selectedGenre,
      customGenre: this.narrative.customGenre || undefined,
      settingSeed: processedSettingSeed,
      expandedSetting: processedExpandedSetting || undefined,
      protagonist: this.character.protagonist || undefined,
      characters: processedCharacters.length > 0 ? processedCharacters : undefined,
      writingStyle: {
        pov: this.narrative.selectedPOV,
        tense: this.narrative.selectedTense,
        tone: this.narrative.tone,
        visualProseMode: this.narrative.visualProseMode,
        imageGenerationMode: this.narrative.imageGenerationMode,
        backgroundImagesEnabled: this.narrative.backgroundImagesEnabled,
        referenceMode: this.narrative.referenceMode,
      },
      title: this.narrative.storyTitle,
      openingGuidance:
        this.narrative.selectedMode === 'creative-writing' && this.narrative.openingGuidance.trim()
          ? this.narrative.openingGuidance.trim()
          : undefined,
    }

    const storyData = await scenarioService.prepareStoryData(wizardData, processedOpening)

    if (storyData.protagonist) {
      storyData.protagonist.portrait = this.image.protagonistPortrait ?? undefined
      storyData.protagonist.visualDescriptors = this.image.protagonistVisualDescriptors
        ? stringToDescriptors(this.image.protagonistVisualDescriptors)
        : {}
    }

    storyData.characters = storyData.characters.map((char) => ({
      ...char,
      portrait: char.name
        ? (this.image.supportingCharacterPortraits[char.name] ?? undefined)
        : undefined,
      visualDescriptors:
        char.name && this.image.supportingCharacterVisualDescriptors[char.name]
          ? stringToDescriptors(this.image.supportingCharacterVisualDescriptors[char.name])
          : {},
    }))

    // Build translations object if we have translations
    const translationSettings = settings.translationSettings
    let translations:
      | {
          language: string
          openingScene?: string
          protagonist?: {
            name?: string
            description?: string
            traits?: string[]
            visualDescriptors?: string[]
          }
          startingLocation?: { name?: string; description?: string }
          characters?: {
            [originalName: string]: {
              name?: string
              description?: string
              relationship?: string
              traits?: string[]
              visualDescriptors?: string[]
            }
          }
        }
      | undefined

    if (TranslationService.shouldTranslate(translationSettings)) {
      const targetLanguage = translationSettings.targetLanguage
      translations = { language: targetLanguage }

      // Opening scene translation
      if (this.narrative.generatedOpeningTranslated?.scene) {
        translations.openingScene = this.narrative.generatedOpeningTranslated.scene
      }

      // Protagonist translation
      if (this.character.protagonistTranslated) {
        // Translate visual descriptors if present
        let protagonistVisualDescriptorsTranslated: string[] | undefined
        if (this.image.protagonistVisualDescriptors?.trim()) {
          try {
            const visualDescriptorsArray = this.image.protagonistVisualDescriptors
              .split(',')
              .map((d) => d.trim())
              .filter(Boolean)
            if (visualDescriptorsArray.length > 0) {
              const translated = await aiService.translateWizardBatch(
                { visualDescriptors: visualDescriptorsArray.join(', ') },
                targetLanguage,
              )
              if (translated.visualDescriptors) {
                protagonistVisualDescriptorsTranslated = translated.visualDescriptors
                  .split(',')
                  .map((d) => d.trim())
                  .filter(Boolean)
              }
            }
          } catch (e) {
            console.error('[Wizard] Failed to translate protagonist visual descriptors:', e)
          }
        }
        translations.protagonist = {
          name: this.character.protagonistTranslated.name,
          description: this.character.protagonistTranslated.description,
          traits: this.character.protagonistTranslated.traits,
          visualDescriptors: protagonistVisualDescriptorsTranslated,
        }
      }

      // Starting location translation (from opening's initialLocation)
      if (this.narrative.generatedOpeningTranslated?.initialLocation) {
        translations.startingLocation = {
          name: this.narrative.generatedOpeningTranslated.initialLocation.name,
          description: this.narrative.generatedOpeningTranslated.initialLocation.description,
        }
      }

      // Supporting characters translation - key by processed name (after placeholder replacement)
      if (this.character.supportingCharactersTranslated.length > 0) {
        translations.characters = {}
        for (let i = 0; i < this.character.supportingCharacters.length; i++) {
          const processed = processedCharacters[i]
          const translated = this.character.supportingCharactersTranslated[i]
          // Use processed name as key since createStoryFromWizard looks up by processed name
          if (processed?.name && translated) {
            // Translate visual descriptors if present for this character
            let charVisualDescriptorsTranslated: string[] | undefined
            const charVisualDescriptors =
              this.image.supportingCharacterVisualDescriptors[processed.name]
            if (charVisualDescriptors?.trim()) {
              try {
                const visualDescriptorsArray = charVisualDescriptors
                  .split(',')
                  .map((d) => d.trim())
                  .filter(Boolean)
                if (visualDescriptorsArray.length > 0) {
                  const translatedVD = await aiService.translateWizardBatch(
                    { visualDescriptors: visualDescriptorsArray.join(', ') },
                    targetLanguage,
                  )
                  if (translatedVD.visualDescriptors) {
                    charVisualDescriptorsTranslated = translatedVD.visualDescriptors
                      .split(',')
                      .map((d) => d.trim())
                      .filter(Boolean)
                  }
                }
              } catch (e) {
                console.error('[Wizard] Failed to translate character visual descriptors:', e)
              }
            }
            translations.characters[processed.name] = {
              name: translated.name,
              description: translated.description,
              relationship: translated.relationship,
              traits: translated.traits,
              visualDescriptors: charVisualDescriptorsTranslated,
            }
          }
        }
      }

      // Debug: log what translations we're passing
      console.log('[Wizard] Translations being passed to createStoryFromWizard:', {
        hasOpeningScene: !!translations.openingScene,
        hasProtagonist: !!translations.protagonist,
        hasStartingLocation: !!translations.startingLocation,
        startingLocation: translations.startingLocation,
        characterCount: translations.characters ? Object.keys(translations.characters).length : 0,
        characters: translations.characters,
      })
    }

    const newStory = await story.createStoryFromWizard({
      ...storyData,
      importedEntries: processedEntries.length > 0 ? processedEntries : undefined,
      translations,
    })

    // Assign pack and save custom variable values
    await database.setStoryPack(newStory.id, this.selectedPackId)
    if (Object.keys(this.customVariableValues).length > 0) {
      await database.setStoryCustomVariables(newStory.id, this.customVariableValues)
    }

    await story.loadStory(newStory.id)
    ui.setActivePanel('story')
    this.onClose()
  }
}
