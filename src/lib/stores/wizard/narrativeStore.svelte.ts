import {
  type Genre,
  type Tense,
  type WizardData,
  scenarioService,
} from '$lib/services/ai/wizard/ScenarioService'
import { aiService } from '$lib/services/ai'
import { TranslationService } from '$lib/services/ai/utils/TranslationService'
import { settings } from '$lib/stores/settings.svelte'
import type {
  TimeTracker,
  StoryMode,
  POV,
  TargetLength,
  NarratorReinforcement,
  VaultLorebook,
  ImageGenerationMode,
} from '$lib/types'
import type { ImportedLorebookItem } from '$lib/components/wizard/wizardTypes'
import type { GeneratedOpening } from '$lib/services/ai/sdk'
import { ContextBuilder } from '$lib/services/context'
import {
  formatStoryTime,
  normalizeTime,
  parseStoryTime,
  returnedStart,
  templateReceivesStartingTime,
  type ResultStartSource,
} from '$lib/services/storyTime'

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
  imageGenerationMode = $state<ImageGenerationMode>('none')
  backgroundImagesEnabled = $state(false)
  referenceMode = $state(false)
  targetLength = $state<TargetLength>('dynamic')
  narratorReinforcement = $state<NarratorReinforcement>('full')

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

  /**
   * A start per opening, not one for the step: each belongs to the opening beside it, and only
   * the one whose opening is used seeds the story.
   */
  /** Beside the imported opening. Prefilled and locked where the scenario stated one. */
  importedStartText = $state('')
  /** Beside the opening the reader writes. Never prefilled. */
  manualStartText = $state('')
  /** What generation is told the opening ends at; the one the prompt warning is about. */
  guidanceStartText = $state('')
  /** What generation came back with, or the guidance when it returned none. */
  resultStartText = $state('')
  resultStartSource = $state<ResultStartSource | null>(null)
  private startBeforeEdit = { text: '', source: null as typeof this.resultStartSource }
  /** Whether the selected pack's opening template renders the start; null until checked. */
  openingReceivesStart = $state<boolean | null>(null)

  // Card Import Integration (for Opening)
  cardImportedFirstMessage = $state<string | null>(null)
  cardImportedAlternateGreetings = $state<string[]>([])
  selectedGreetingIndex = $state<number>(0)

  // Derived
  importedEntries = $derived(this.importedLorebooks.flatMap((lb) => lb.entries))

  generatedOpeningDisplay = $derived(this.generatedOpeningTranslated ?? this.generatedOpening)

  importedStart = $derived(parseStoryTime(this.importedStartText))
  manualStart = $derived(parseStoryTime(this.manualStartText))
  resultStart = $derived(parseStoryTime(this.resultStartText))

  /**
   * The start that seeds the story: the one belonging to the opening that will be used, in the
   * order `createStory` picks an opening — generated, then written, then imported.
   */
  startingTime = $derived(
    this.generatedOpening
      ? this.resultStart
      : this.manualOpeningText.trim()
        ? this.manualStart
        : this.importedStart,
  )

  /** The pack the wizard has selected; read live, since the user can change it mid-wizard. */
  private packId: () => string | undefined

  constructor(packId: () => string | undefined) {
    this.packId = packId
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

  // Starting time

  /** A scenario's own start fills the field beside its opening, and locks it. */
  setImportedStart(start: TimeTracker | null | undefined) {
    this.importedStartText = start ? formatStoryTime(start) : ''
  }

  /**
   * Resolve the opening template this pack will run for the mode and ask whether it renders the
   * start, in either half. Rechecked before each generation, since the pack can change.
   */
  async checkOpeningReceivesStart(
    kind: 'generation' | 'refinement' = 'generation',
    packId: string | undefined = this.packId(),
  ) {
    const style = this.selectedMode === 'creative-writing' ? 'creative' : 'adventure'
    const templateId = `opening-${kind}-${style}`
    const builder = new ContextBuilder(packId)
    const [system, user] = await Promise.all([
      builder.resolveTemplate(templateId),
      builder.resolveTemplate(`${templateId}-user`),
    ])
    const receives =
      templateReceivesStartingTime(system?.content) || templateReceivesStartingTime(user?.content)
    if (kind === 'generation') this.openingReceivesStart = receives
    return receives
  }

  /**
   * The guidance for this run, read after its template is checked: the check can change what a
   * previous one decided, so reading it before would send one run the last run's answer.
   */
  private async guidanceFor(
    kind: 'generation' | 'refinement',
    packId: string | undefined,
  ): Promise<TimeTracker | null> {
    const received = await this.checkOpeningReceivesStart(kind, packId)
    return received ? parseStoryTime(this.guidanceStartText) : null
  }

  private applyReturnedStart(opening: GeneratedOpening, guidance: TimeTracker | null) {
    const { text, source } = returnedStart(opening.startingTime, guidance)
    this.resultStartText = text
    this.resultStartSource = source
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
      // One pack for the whole run: the one checked must be the one that generates.
      const packId = this.packId()
      const guidance = await this.guidanceFor('generation', packId)
      this.generatedOpening = await scenarioService.generateOpening(
        packId,
        { ...wizardData, startingTime: guidance },
        settings.servicePresetAssignments['wizard:openingGeneration'],
        lorebookContext,
      )
      this.applyReturnedStart(this.generatedOpening, guidance)

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

      const packId = this.packId()
      const guidance = await this.guidanceFor('refinement', packId)
      this.generatedOpening = await scenarioService.refineOpening(
        packId,
        { ...wizardData, startingTime: guidance },
        currentOpening,
        settings.servicePresetAssignments['wizard:openingRefinement'],
        lorebookContext,
      )
      // A refinement that returns no time keeps the start the opening already had, the reader's
      // own edit included, rather than falling back to the guidance.
      const returned = parseStoryTime(this.generatedOpening.startingTime ?? '')
      if (returned || !this.resultStart) {
        this.applyReturnedStart(this.generatedOpening, guidance)
      }
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
          this.packId(),
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
    // A run in flight replaces the opening and decides its start, so it cannot be edited under it.
    if (!this.generatedOpening || this.isEditingOpening) return
    if (this.isRefiningOpening || this.isGeneratingOpening) return
    this.openingError = null
    this.openingDraft = this.generatedOpening.scene
    this.startBeforeEdit = { text: this.resultStartText, source: this.resultStartSource }
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
    if (this.resultStartText !== this.startBeforeEdit.text) {
      this.resultStartSource = this.resultStartText.trim() ? 'edited' : null
    }
    if (this.resultStart) this.resultStartText = formatStoryTime(normalizeTime(this.resultStart))
    this.clearOpeningEditState()
  }

  cancelOpeningEdit() {
    if (!this.generatedOpening) return
    this.resultStartText = this.startBeforeEdit.text
    this.resultStartSource = this.startBeforeEdit.source
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
