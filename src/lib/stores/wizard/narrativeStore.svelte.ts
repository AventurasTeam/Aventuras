import {
  type Genre,
  type Tense,
  type WizardData,
  scenarioService,
} from '$lib/services/ai/wizard/ScenarioService'
import { aiService } from '$lib/services/ai'
import { TranslationService } from '$lib/services/ai/utils/TranslationService'
import { settings } from '$lib/stores/settings.svelte'
import type { StoryMode, POV, VaultLorebook } from '$lib/types'
import type { ImportedLorebookItem } from '$lib/components/wizard/wizardTypes'
import type { GeneratedOpening } from '$lib/services/ai/sdk'

export class NarrativeStore {
  // Step 1: Mode
  selectedMode = $state<StoryMode>('adventure')

  // Step 2: Lorebook
  importedLorebooks = $state<ImportedLorebookItem[]>([])
  importError = $state<string | null>(null)

  // Step 3: Genre
  selectedGenre = $state<Genre>('fantasy')
  customGenre = $state('')

  // Step 8: Writing Style
  selectedPOV = $state<POV>('first')
  selectedTense = $state<Tense>('present')
  tone = $state('immersive and engaging')
  visualProseMode = $state(false)
  imageGenerationMode = $state<'none' | 'agentic' | 'inline'>('none')
  backgroundImagesEnabled = $state(false)
  referenceMode = $state(false)

  // Step 9: Opening
  storyTitle = $state('')
  openingGuidance = $state('')
  generatedOpening = $state<GeneratedOpening | null>(null)
  generatedOpeningTranslated = $state<GeneratedOpening | null>(null)
  isGeneratingOpening = $state(false)
  isRefiningOpening = $state(false)
  openingError = $state<string | null>(null)
  isEditingOpening = $state(false)
  openingDraft = $state('')
  manualOpeningText = $state('')

  // Card Import Integration (for Opening)
  cardImportedFirstMessage = $state<string | null>(null)
  cardImportedAlternateGreetings = $state<string[]>([])
  selectedGreetingIndex = $state<number>(0)

  // Derived
  importedEntries = $derived(this.importedLorebooks.flatMap((lb) => lb.entries))

  generatedOpeningDisplay = $derived(this.generatedOpeningTranslated ?? this.generatedOpening)

  constructor() {
    // Update default POV and tense when mode changes
    // $effect(() => {
    //   if (this.selectedMode === "creative-writing") {
    //     if (this.selectedPOV === "first" || this.selectedPOV === "second") {
    //       this.selectedTense = "past";
    //     } else {
    //       this.selectedPOV = "third";
    //       this.selectedTense = "past";
    //     }
    //   } else {
    //     this.selectedPOV = "first";
    //     this.selectedTense = "present";
    //   }
    // });
  }

  // Genre Actions
  setCustomGenre(genre: string) {
    this.customGenre = genre
    this.selectedGenre = 'custom'
  }

  // Lorebook Actions
  addLorebookFromVault(vaultLorebook: VaultLorebook) {
    const entries = vaultLorebook.entries.map((e) => ({
      ...e,
    }))

    // Ensure metadata matches LorebookImportResult structure
    const baseMetadata = vaultLorebook.metadata || {
      format: 'aventura',
      totalEntries: entries.length,
      entryBreakdown: {
        character: 0,
        location: 0,
        item: 0,
        faction: 0,
        concept: 0,
        event: 0,
      },
    }

    const metadata = {
      format: baseMetadata.format,
      totalEntries: baseMetadata.totalEntries,
      importedEntries: entries.length,
      skippedEntries: 0,
    }

    this.importedLorebooks = [
      ...this.importedLorebooks,
      {
        id: crypto.randomUUID(),
        vaultId: vaultLorebook.id,
        filename: `${vaultLorebook.name} (from Vault)`,
        result: {
          success: true,
          entries: entries,
          errors: [],
          warnings: [],
          metadata: metadata,
        },
        entries: entries,
        expanded: true,
      },
    ]
  }

  removeLorebook(id: string) {
    this.importedLorebooks = this.importedLorebooks.filter((lb) => lb.id !== id)
    if (this.importedLorebooks.length === 0) {
      this.importError = null
    }
  }

  toggleLorebookExpanded(id: string) {
    this.importedLorebooks = this.importedLorebooks.map((lb) =>
      lb.id === id ? { ...lb, expanded: !lb.expanded } : lb,
    )
  }

  clearAllLorebooks() {
    this.importedLorebooks = []
    this.importError = null
  }

  // Opening Actions
  async generateOpeningScene(wizardData: WizardData) {
    if (this.isGeneratingOpening) return

    this.isGeneratingOpening = true
    this.openingError = null
    this.clearOpeningEditState()
    this.manualOpeningText = ''

    const lorebookContext =
      this.importedEntries.length > 0
        ? this.importedEntries.map((e) => ({
            name: e.name,
            type: e.type,
            description: e.description,
            hiddenInfo: undefined,
          }))
        : undefined

    try {
      this.generatedOpening = await scenarioService.generateOpening(
        wizardData,
        settings.servicePresetAssignments['wizard:openingGeneration'],
        lorebookContext,
      )

      await this.translateOpening()
    } catch (error) {
      console.error('Failed to generate opening:', error)
      this.openingError = error instanceof Error ? error.message : 'Failed to generate opening'
    } finally {
      this.isGeneratingOpening = false
    }
  }

  async refineOpeningScene(wizardData: WizardData) {
    if (!this.generatedOpening || this.isRefiningOpening) return

    this.isRefiningOpening = true
    this.openingError = null

    const lorebookContext =
      this.importedEntries.length > 0
        ? this.importedEntries.map((e) => ({
            name: e.name,
            type: e.type,
            description: e.description,
            hiddenInfo: undefined,
          }))
        : undefined

    try {
      const currentOpening = this.storyTitle.trim()
        ? { ...this.generatedOpening, title: this.storyTitle.trim() }
        : this.generatedOpening

      this.generatedOpening = await scenarioService.refineOpening(
        wizardData,
        currentOpening,
        settings.servicePresetAssignments['wizard:openingRefinement'],
        lorebookContext,
      )
      this.clearOpeningEditState()
      await this.translateOpening()
    } catch (error) {
      console.error('Failed to refine opening:', error)
      this.openingError = error instanceof Error ? error.message : 'Failed to refine opening'
    } finally {
      this.isRefiningOpening = false
    }
  }

  async translateOpening() {
    const translationSettings = settings.translationSettings
    if (this.generatedOpening && TranslationService.shouldTranslate(translationSettings)) {
      try {
        const fields: Record<string, string> = {
          scene: this.generatedOpening.scene,
          title: this.generatedOpening.title,
        }
        if (this.generatedOpening.initialLocation?.name) {
          fields.locName = this.generatedOpening.initialLocation.name
        }
        if (this.generatedOpening.initialLocation?.description) {
          fields.locDesc = this.generatedOpening.initialLocation.description
        }

        const translated = await aiService.translateWizardBatch(
          fields,
          translationSettings.targetLanguage,
        )

        this.generatedOpeningTranslated = {
          ...this.generatedOpening,
          scene: translated.scene || this.generatedOpening.scene,
          title: translated.title || this.generatedOpening.title,
          initialLocation: this.generatedOpening.initialLocation
            ? {
                name: translated.locName || this.generatedOpening.initialLocation.name,
                description:
                  translated.locDesc || this.generatedOpening.initialLocation.description,
              }
            : this.generatedOpening.initialLocation,
        }
      } catch (translationError) {
        console.error('Opening translation failed (non-fatal):', translationError)
        this.generatedOpeningTranslated = null
      }
    } else {
      this.generatedOpeningTranslated = null
    }
  }

  clearOpeningEditState() {
    this.isEditingOpening = false
    this.openingDraft = ''
  }

  clearGeneratedOpening() {
    this.generatedOpening = null
    this.generatedOpeningTranslated = null
    this.openingError = null
  }

  startOpeningEdit() {
    if (!this.generatedOpening || this.isEditingOpening) return
    this.openingError = null
    this.openingDraft = this.generatedOpening.scene
    this.isEditingOpening = true
  }

  saveOpeningEdit() {
    if (!this.generatedOpening) return
    if (!this.openingDraft?.trim()) {
      this.openingError = 'Opening text cannot be empty'
      return
    }
    this.generatedOpening = {
      ...this.generatedOpening,
      title: this.storyTitle.trim() || this.generatedOpening.title,
      scene: this.openingDraft,
    }
    this.clearOpeningEditState()
  }

  cancelOpeningEdit() {
    if (!this.generatedOpening) return
    this.clearOpeningEditState()
  }

  useCardOpening() {
    const selectedScene =
      this.selectedGreetingIndex === 0
        ? this.cardImportedFirstMessage
        : this.cardImportedAlternateGreetings[this.selectedGreetingIndex - 1]

    // Default location if none exists (will be populated from setting if available in orchestrator)
    this.generatedOpening = {
      title: this.storyTitle,
      scene: selectedScene || '',
      initialLocation: {
        name: 'Starting Location',
        description: 'The scene begins here.',
      },
    }
    this.openingError = null
    this.clearOpeningEditState()
  }
}
