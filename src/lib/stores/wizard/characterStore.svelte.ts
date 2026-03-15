import { type Genre, scenarioService } from '$lib/services/ai/wizard/ScenarioService'
import { aiService } from '$lib/services/ai'
import { TranslationService } from '$lib/services/ai/utils/TranslationService'
import { settings } from '$lib/stores/settings.svelte'
import { characterVault } from '$lib/stores/characterVault.svelte'
import type { StoryMode, POV, VaultCharacter } from '$lib/types'
import { descriptorsToString, stringToDescriptors } from '$lib/utils/visualDescriptors'
import { CharacterCardImport } from '$lib/services/characterCardImport'
import type {
  ExpandedSetting,
  GeneratedCharacter,
  GeneratedProtagonist,
} from '$lib/services/ai/sdk'
import { SvelteSet } from 'svelte/reactivity'

export class CharacterStore {
  // Protagonist State
  protagonist = $state<GeneratedProtagonist | null>(null)
  protagonistTranslated = $state<GeneratedProtagonist | null>(null)
  isGeneratingProtagonist = $state(false)
  isExpandingCharacter = $state(false)
  isRefiningCharacter = $state(false)
  protagonistError = $state<string | null>(null)

  // Manual Input State
  manualCharacterName = $state('')
  manualCharacterDescription = $state('')
  manualCharacterBackground = $state('')
  manualCharacterMotivation = $state('')
  manualCharacterTraits = $state('')
  showManualInput = $state(true)
  characterElaborationGuidance = $state('')

  // Supporting Characters State
  supportingCharacters = $state<GeneratedCharacter[]>([])
  supportingCharactersTranslated = $state<GeneratedCharacter[]>([])
  isGeneratingCharacters = $state(false)

  // Supporting Character Form State
  showSupportingCharacterForm = $state(false)
  editingSupportingCharacterIndex = $state<number | null>(null)
  supportingCharacterName = $state('')
  supportingCharacterRole = $state('')
  supportingCharacterDescription = $state('')
  supportingCharacterRelationship = $state('')
  supportingCharacterTraits = $state('')
  isElaboratingSupportingCharacter = $state(false)
  supportingCharacterGuidance = $state('')
  supportingCharacterVaultId = $state<string | null>(null)

  // Vault Integration
  showProtagonistVaultPicker = $state(false)
  showSupportingVaultPicker = $state(false)
  savedToVaultConfirm = $state(false)

  // Card Import State
  isImportingCard = $state(false)
  cardImportError = $state<string | null>(null)
  importedCardNpcs = $state<GeneratedCharacter[]>([])
  cardImportFileInput: HTMLInputElement | null = null // DOM ref, maybe keep in component but logic needs access?
  // Stores these from card import for use in other steps (Setting/Opening)
  cardImportedTitle = $state<string | null>(null)
  cardImportedFirstMessage = $state<string | null>(null)
  cardImportedAlternateGreetings = $state<string[]>([])
  selectedGreetingIndex = $state<number>(0)

  // Also setting seed from card import
  importedSettingSeed = $state<string | null>(null)

  // Derived
  protagonistDisplay = $derived(this.protagonistTranslated ?? this.protagonist)
  supportingCharactersDisplay = $derived(
    this.supportingCharactersTranslated.length > 0
      ? this.supportingCharactersTranslated
      : this.supportingCharacters,
  )

  // Protagonist Actions
  async generateProtagonist(
    expandedSetting: ExpandedSetting,
    selectedGenre: Genre,
    selectedMode: StoryMode,
    selectedPOV: POV,
    customGenre?: string,
  ) {
    if (!expandedSetting || this.isGeneratingProtagonist) return

    this.isGeneratingProtagonist = true
    this.protagonistError = null

    try {
      this.protagonist = await scenarioService.generateProtagonist(
        expandedSetting,
        selectedGenre,
        selectedMode,
        selectedPOV,
        customGenre || undefined,
        settings.servicePresetAssignments['wizard:protagonistGeneration'],
      )

      await this.translateProtagonist()
    } catch (error) {
      console.error('Failed to generate protagonist:', error)
      this.protagonistError =
        error instanceof Error ? error.message : 'Failed to generate protagonist'
    } finally {
      this.isGeneratingProtagonist = false
    }
  }

  useManualCharacter() {
    if (!this.manualCharacterName.trim()) return

    this.protagonist = {
      name: this.manualCharacterName.trim(),
      description: this.manualCharacterDescription.trim() || 'A mysterious figure.',
      background: this.manualCharacterBackground.trim() || '',
      motivation: this.manualCharacterMotivation.trim() || '',
      traits: this.manualCharacterTraits.trim()
        ? this.manualCharacterTraits
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    }
    this.showManualInput = false
  }

  editCharacter() {
    if (this.protagonist) {
      this.manualCharacterName = this.protagonist.name || ''
      this.manualCharacterDescription = this.protagonist.description || ''
      this.manualCharacterBackground = this.protagonist.background || ''
      this.manualCharacterMotivation = this.protagonist.motivation || ''
      this.manualCharacterTraits = this.protagonist.traits?.join(', ') || ''
    }
    this.showManualInput = true
    this.protagonist = null
  }

  async elaborateCharacter(
    expandedSetting: ExpandedSetting | null,
    selectedGenre: Genre,
    customGenre?: string,
    useCurrentProtagonist: boolean = false,
  ) {
    if (this.isExpandingCharacter) return

    const sourceName =
      useCurrentProtagonist && this.protagonist
        ? this.protagonist.name
        : this.manualCharacterName.trim()
    const sourceDescription =
      useCurrentProtagonist && this.protagonist
        ? this.protagonist.description
        : this.manualCharacterDescription.trim()
    const sourceBackground =
      useCurrentProtagonist && this.protagonist
        ? this.protagonist.background
        : this.manualCharacterBackground.trim()
    const sourceMotivation =
      useCurrentProtagonist && this.protagonist
        ? this.protagonist.motivation
        : this.manualCharacterMotivation.trim()
    const sourceTraits =
      useCurrentProtagonist && this.protagonist
        ? this.protagonist.traits
        : this.manualCharacterTraits.trim()
          ? this.manualCharacterTraits
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined

    const hasInput = sourceName || sourceDescription || sourceBackground || sourceMotivation

    if (!hasInput) {
      this.protagonistError = 'Please enter at least some character details to elaborate on.'
      return
    }

    this.isExpandingCharacter = true
    this.protagonistError = null

    try {
      this.protagonist = await scenarioService.elaborateCharacter(
        {
          name: sourceName || undefined,
          description: sourceDescription || undefined,
          background: sourceBackground || undefined,
          motivation: sourceMotivation || undefined,
          traits: sourceTraits,
        },
        expandedSetting,
        selectedGenre,
        customGenre || undefined,
        settings.servicePresetAssignments['wizard:characterElaboration'],
        this.characterElaborationGuidance.trim() || undefined,
      )
      this.showManualInput = false
      this.characterElaborationGuidance = ''

      await this.translateProtagonist()
    } catch (error) {
      console.error('Failed to elaborate character:', error)
      this.protagonistError =
        error instanceof Error ? error.message : 'Failed to elaborate character'
    } finally {
      this.isExpandingCharacter = false
    }
  }

  async elaborateCharacterFurther(
    expandedSetting: ExpandedSetting | null,
    selectedGenre: Genre,
    customGenre?: string,
  ) {
    if (!this.protagonist || this.isRefiningCharacter) return

    this.isRefiningCharacter = true
    this.protagonistError = null

    try {
      this.protagonist = await scenarioService.refineCharacter(
        this.protagonist,
        expandedSetting,
        selectedGenre,
        customGenre || undefined,
        settings.servicePresetAssignments['wizard:characterRefinement'],
        this.characterElaborationGuidance.trim() || undefined,
      )
      this.characterElaborationGuidance = ''

      await this.translateProtagonist()
    } catch (error) {
      console.error('Failed to refine character:', error)
      this.protagonistError = error instanceof Error ? error.message : 'Failed to refine character'
    } finally {
      this.isRefiningCharacter = false
    }
  }

  // Supporting Character Actions
  async generateCharacters(
    expandedSetting: ExpandedSetting,
    selectedGenre: Genre,
    customGenre?: string,
  ) {
    if (!expandedSetting || !this.protagonist || this.isGeneratingCharacters) return

    this.isGeneratingCharacters = true

    try {
      this.supportingCharacters = await scenarioService.generateCharacters(
        expandedSetting,
        this.protagonist,
        selectedGenre,
        3,
        customGenre || undefined,
        settings.servicePresetAssignments['wizard:supportingCharacters'],
      )

      await this.translateSupportingCharacters()
    } catch (error) {
      console.error('Failed to generate characters:', error)
    } finally {
      this.isGeneratingCharacters = false
    }
  }

  openSupportingCharacterForm() {
    this.editingSupportingCharacterIndex = null
    this.supportingCharacterName = ''
    this.supportingCharacterRole = ''
    this.supportingCharacterDescription = ''
    this.supportingCharacterRelationship = ''
    this.supportingCharacterTraits = ''
    this.showSupportingCharacterForm = true
    this.supportingCharacterVaultId = null
  }

  editSupportingCharacter(index: number) {
    const char = this.supportingCharacters[index]
    this.editingSupportingCharacterIndex = index
    this.supportingCharacterName = char.name
    this.supportingCharacterRole = char.role || ''
    this.supportingCharacterDescription = char.description
    this.supportingCharacterRelationship = char.relationship || ''
    this.supportingCharacterTraits = char.traits?.join(', ') || ''
    this.showSupportingCharacterForm = true
  }

  cancelSupportingCharacterForm() {
    this.showSupportingCharacterForm = false
    this.editingSupportingCharacterIndex = null
    this.supportingCharacterName = ''
    this.supportingCharacterRole = ''
    this.supportingCharacterDescription = ''
    this.supportingCharacterRelationship = ''
    this.supportingCharacterTraits = ''
    this.supportingCharacterGuidance = ''
    this.supportingCharacterVaultId = null
  }

  useSupportingCharacterAsIs() {
    if (!this.supportingCharacterName.trim()) return

    const newChar: GeneratedCharacter = {
      name: this.supportingCharacterName.trim(),
      role: this.supportingCharacterRole.trim() || 'supporting',
      description: this.supportingCharacterDescription.trim() || '',
      relationship: this.supportingCharacterRelationship.trim() || '',
      traits: this.supportingCharacterTraits.trim()
        ? this.supportingCharacterTraits
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      vaultId: this.supportingCharacterVaultId ?? undefined,
    }

    if (this.editingSupportingCharacterIndex !== null) {
      this.supportingCharacters[this.editingSupportingCharacterIndex] = newChar
      // Trigger update
      this.supportingCharacters = [...this.supportingCharacters]
    } else {
      this.supportingCharacters = [...this.supportingCharacters, newChar]
    }

    this.cancelSupportingCharacterForm()
  }

  deleteSupportingCharacter(index: number) {
    this.supportingCharacters = this.supportingCharacters.filter((_, i) => i !== index)
  }

  async elaborateSupportingCharacter(
    expandedSetting: ExpandedSetting | null,
    selectedGenre: Genre,
    customGenre?: string,
  ) {
    if (this.isElaboratingSupportingCharacter) return

    const hasInput =
      this.supportingCharacterName.trim() ||
      this.supportingCharacterDescription.trim() ||
      this.supportingCharacterRelationship.trim()

    if (!hasInput) return

    this.isElaboratingSupportingCharacter = true

    try {
      const elaborated = await scenarioService.elaborateCharacter(
        {
          name: this.supportingCharacterName.trim() || undefined,
          description: this.supportingCharacterDescription.trim() || undefined,
          background: this.supportingCharacterRelationship.trim() || undefined,
          motivation: this.supportingCharacterRole.trim() || undefined,
          traits: this.supportingCharacterTraits.trim()
            ? this.supportingCharacterTraits
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            : undefined,
        },
        expandedSetting,
        selectedGenre,
        customGenre || undefined,
        settings.servicePresetAssignments['wizard:characterElaboration'],
        this.supportingCharacterGuidance.trim() || undefined,
      )

      const newChar: GeneratedCharacter = {
        name: elaborated.name,
        role: this.supportingCharacterRole.trim() || 'supporting',
        description: elaborated.description,
        relationship: this.supportingCharacterRelationship.trim() || elaborated.background || '',
        traits: elaborated.traits || [],
      }

      if (this.editingSupportingCharacterIndex !== null) {
        this.supportingCharacters[this.editingSupportingCharacterIndex] = newChar
        this.supportingCharacters = [...this.supportingCharacters]
      } else {
        this.supportingCharacters = [...this.supportingCharacters, newChar]
      }

      this.supportingCharacterGuidance = ''
      this.cancelSupportingCharacterForm()
    } catch (error) {
      console.error('Failed to elaborate supporting character:', error)
    } finally {
      this.isElaboratingSupportingCharacter = false
    }
  }

  // Vault Actions
  handleSelectProtagonistFromVault(
    vaultCharacter: VaultCharacter,
    visualDescriptorsSetter: (v: string) => void,
    portraitSetter: (v: string | null) => void,
  ) {
    this.manualCharacterName = vaultCharacter.name
    this.manualCharacterDescription = vaultCharacter.description || ''
    const metadata = (vaultCharacter.metadata as Record<string, any>) || {}
    this.manualCharacterBackground = (metadata.background as string) || ''
    this.manualCharacterMotivation = (metadata.motivation as string) || ''
    this.manualCharacterTraits = vaultCharacter.traits.join(', ')
    visualDescriptorsSetter(descriptorsToString(vaultCharacter.visualDescriptors))
    portraitSetter(vaultCharacter.portrait)

    this.showProtagonistVaultPicker = false
    this.showManualInput = true
    this.useManualCharacter()
  }

  async handleSaveProtagonistToVault(visualDescriptors: string, portrait: string | null) {
    if (!this.manualCharacterName.trim()) return

    if (!characterVault.isLoaded) {
      await characterVault.load()
    }

    await characterVault.add({
      name: this.manualCharacterName.trim(),
      description: this.manualCharacterDescription.trim() || null,
      traits: this.manualCharacterTraits
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      visualDescriptors: stringToDescriptors(visualDescriptors),
      portrait: portrait,
      tags: [],
      favorite: false,
      source: 'manual',
      originalStoryId: null,
      metadata: {
        characterType: 'protagonist',
        background: this.manualCharacterBackground.trim() || null,
        motivation: this.manualCharacterMotivation.trim() || null,
      },
    })

    this.savedToVaultConfirm = true
    setTimeout(() => (this.savedToVaultConfirm = false), 2000)
  }

  handleSelectSupportingFromVault(
    vaultCharacter: VaultCharacter,
    visualDescriptorsSetter: (name: string, v: string) => void,
    portraitSetter: (name: string, v: string | null) => void,
  ) {
    this.supportingCharacterName = vaultCharacter.name
    const metadata = (vaultCharacter.metadata as Record<string, any>) || {}
    this.supportingCharacterRole = (metadata.role as string) || ''
    this.supportingCharacterDescription = vaultCharacter.description || ''
    this.supportingCharacterRelationship = (metadata.relationshipTemplate as string) || ''
    this.supportingCharacterTraits = vaultCharacter.traits.join(', ')

    visualDescriptorsSetter(
      vaultCharacter.name,
      descriptorsToString(vaultCharacter.visualDescriptors),
    )
    portraitSetter(vaultCharacter.name, vaultCharacter.portrait)

    this.supportingCharacterVaultId = vaultCharacter.id

    this.showSupportingVaultPicker = false
    this.showSupportingCharacterForm = true
    this.useSupportingCharacterAsIs()
  }

  // Translation helpers
  async translateProtagonist() {
    const translationSettings = settings.translationSettings
    if (this.protagonist && TranslationService.shouldTranslate(translationSettings)) {
      try {
        const fields: Record<string, string> = {
          name: this.protagonist.name,
          description: this.protagonist.description,
        }

        if (this.protagonist.background) fields.background = this.protagonist.background
        if (this.protagonist.motivation) fields.motivation = this.protagonist.motivation
        if (this.protagonist.traits?.length) fields.traits = this.protagonist.traits.join(', ')

        const translated = await aiService.translateWizardBatch(
          fields,
          translationSettings.targetLanguage,
        )

        this.protagonistTranslated = {
          ...this.protagonist,
          name: translated.name || this.protagonist.name,
          description: translated.description || this.protagonist.description,
          background: translated.background || this.protagonist.background,
          motivation: translated.motivation || this.protagonist.motivation,
          traits: translated.traits
            ? translated.traits
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            : this.protagonist.traits,
        }
      } catch (translationError) {
        console.error('Protagonist translation failed (non-fatal):', translationError)
        this.protagonistTranslated = null
      }
    } else {
      this.protagonistTranslated = null
    }
  }

  async translateSupportingCharacters() {
    const translationSettings = settings.translationSettings
    if (
      this.supportingCharacters.length > 0 &&
      TranslationService.shouldTranslate(translationSettings)
    ) {
      try {
        this.supportingCharactersTranslated = await Promise.all(
          this.supportingCharacters.map((char) =>
            this.translateSupportingCharacter(char, translationSettings.targetLanguage),
          ),
        )
      } catch (translationError) {
        console.error('Supporting characters translation failed (non-fatal):', translationError)
        this.supportingCharactersTranslated = []
      }
    } else {
      this.supportingCharactersTranslated = []
    }
  }

  private async translateSupportingCharacter(
    char: GeneratedCharacter,
    targetLanguage: string,
  ): Promise<GeneratedCharacter> {
    const fields: Record<string, string> = {
      name: char.name,
      description: char.description,
    }

    if (char.role) fields.role = char.role
    if (char.relationship) fields.relationship = char.relationship
    if (char.traits?.length) fields.traits = char.traits.join(', ')

    const translated = await aiService.translateWizardBatch(fields, targetLanguage)

    return {
      ...char,
      name: translated.name || char.name,
      description: translated.description || char.description,
      role: translated.role || char.role,
      relationship: translated.relationship || char.relationship,
      traits: translated.traits
        ? translated.traits
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : char.traits,
    }
  }

  // Card Import
  async handleCardImport(file: File, selectedGenre: Genre) {
    this.cardImportError = null
    this.isImportingCard = true

    try {
      const content = await CharacterCardImport.readFile(file)
      const result = await CharacterCardImport.clean(content, selectedGenre)

      if (!result.success && result.errors.length > 0) {
        this.cardImportError = result.errors.join('; ')
      }

      if (result.settingSeed) {
        this.importedSettingSeed = result.settingSeed
      }

      if (result.npcs && result.npcs.length > 0) {
        this.supportingCharacters = [...this.supportingCharacters, ...result.npcs]
        this.importedCardNpcs = result.npcs
      }

      if (result.storyTitle) {
        this.cardImportedTitle = result.storyTitle
      }
      if (result.firstMessage) {
        this.cardImportedFirstMessage = result.firstMessage
        this.cardImportedAlternateGreetings = result.alternateGreetings || []
        this.selectedGreetingIndex = 0
      }

      if (this.cardImportFileInput) {
        this.cardImportFileInput.value = ''
      }
    } catch (err) {
      this.cardImportError = err instanceof Error ? err.message : 'Failed to import character card'
    } finally {
      this.isImportingCard = false
    }
  }

  clearCardImport() {
    if (this.importedCardNpcs.length > 0) {
      const importedNames = new SvelteSet(this.importedCardNpcs.map((n) => n.name))
      this.supportingCharacters = this.supportingCharacters.filter(
        (c) => !importedNames.has(c.name),
      )
    }
    this.importedCardNpcs = []
    this.cardImportError = null
    this.cardImportedTitle = null
    this.cardImportedFirstMessage = null
    this.cardImportedAlternateGreetings = []
    this.selectedGreetingIndex = 0
    this.importedSettingSeed = null

    if (this.cardImportFileInput) {
      this.cardImportFileInput.value = ''
    }
  }
}
