import { story } from '$lib/stores/story.svelte'
import { ui } from '$lib/stores/ui.svelte'
import { settings } from '$lib/stores/settings.svelte'
import { scenarioService, type WizardData } from '$lib/services/ai/wizard/ScenarioService'
import { parseSTChat, type STChatParseResult, type STChatMessage } from '$lib/services/stChatImporter'
import {
  readCharacterCardFile,
  parseCharacterCard,
  convertCardToScenario,
  type ParsedCard,
  type CardImportResult,
} from '$lib/services/characterCardImporter'
import { extractEmbeddedLorebook } from '$lib/services/lorebookImporter'
import { replaceUserPlaceholders } from '$lib/components/wizard/wizardTypes'
import type { ImportedLorebookItem } from '$lib/components/wizard/wizardTypes'
import type { StoryMode, POV, VaultLorebook, VaultLorebookEntry } from '$lib/types'
import type { ExpandedSetting, GeneratedCharacter, GeneratedOpening, GeneratedProtagonist } from '$lib/services/ai/sdk'
import type { Genre, Tense } from '$lib/services/ai/wizard/ScenarioService'
import type { LorebookImportResult } from '$lib/services/lorebookImporter'
import { lorebookVault } from '$lib/stores/lorebookVault.svelte'
import { characterVault } from '$lib/stores/characterVault.svelte'
import { scenarioVault } from '$lib/stores/scenarioVault.svelte'
import { stringToDescriptors } from '$lib/utils/visualDescriptors'
import { database } from '$lib/services/database'

export class STImportWizardStore {
  // Step navigation
  currentStep = $state(1)
  totalSteps = 6

  // Step 1: File Uploads
  chatParseResult = $state<STChatParseResult | null>(null)
  chatFileError = $state<string | null>(null)

  cardParsedData = $state<ParsedCard | null>(null)
  cardRawJson = $state<string | null>(null)
  cardPortrait = $state<string | null>(null) // base64 data URL from PNG
  cardFileError = $state<string | null>(null)

  // Step 2: Import Selection
  importCharacters = $state(true)
  importScenario = $state(true)
  importLorebook = $state(true)
  isProcessingCard = $state(false)
  cardImportResult = $state<CardImportResult | null>(null)
  cardProcessError = $state<string | null>(null)

  embeddedLorebookData = $state<{ name: string; entries: VaultLorebookEntry[]; result: LorebookImportResult } | null>(null)

  // Step 3: Characters
  protagonist = $state<GeneratedProtagonist | null>(null)
  manualCharacterName = $state('')
  manualCharacterDescription = $state('')
  manualCharacterBackground = $state('')
  manualCharacterMotivation = $state('')
  manualCharacterTraits = $state('')
  showManualInput = $state(true)
  supportingCharacters = $state<GeneratedCharacter[]>([])

  // Step 4: World & Lorebook
  settingSeed = $state('')
  expandedSetting = $state<ExpandedSetting | null>(null)
  isExpandingSetting = $state(false)
  settingError = $state<string | null>(null)
  importedLorebooks = $state<ImportedLorebookItem[]>([])

  // Step 5: Writing Style & Chat Options
  selectedMode = $state<StoryMode>('adventure')
  selectedGenre = $state<Genre>('custom')
  customGenre = $state('')
  selectedPOV = $state<POV>('second')
  selectedTense = $state<Tense>('present')
  tone = $state('immersive and engaging')
  importChatAsEntries = $state(true) // true = import chat, false = fresh start with card opening

  // Step 6: Review
  storyTitle = $state('')
  isCreatingStory = $state(false)
  createError = $state<string | null>(null)
  saveToVault = $state(false)

  // Callback
  onClose: () => void

  constructor(onClose: () => void) {
    this.onClose = onClose
  }

  // Derived
  get hasCard(): boolean {
    return this.cardParsedData !== null
  }

  get hasEmbeddedLorebook(): boolean {
    return this.embeddedLorebookData !== null && this.embeddedLorebookData.entries.length > 0
  }

  get chatMessages(): STChatMessage[] {
    return this.chatParseResult?.messages ?? []
  }

  get importedEntries() {
    return this.importedLorebooks.flatMap((lb) => lb.entries)
  }

  get openingText(): string {
    if (this.importChatAsEntries && this.chatParseResult) {
      // First few messages as preview
      const first = this.chatParseResult.messages.slice(0, 3)
      return first.map((m) => m.content).join('\n\n')
    }
    if (this.cardImportResult?.firstMessage) {
      return this.cardImportResult.firstMessage
    }
    return ''
  }

  // === Navigation ===

  canProceed(): boolean {
    switch (this.currentStep) {
      case 1: // Upload Files
        return this.chatParseResult !== null
      case 2: // Import Selection
        return !this.isProcessingCard
      case 3: // Characters
        return this.protagonist !== null
      case 4: // World & Lorebook
        return this.settingSeed.trim().length > 0
      case 5: // Writing Style
        return true
      case 6: // Review
        return this.storyTitle.trim().length > 0
      default:
        return false
    }
  }

  nextStep() {
    if (this.currentStep < this.totalSteps && this.canProceed()) {
      this.currentStep++
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--
    }
  }

  // === Step 1: File Upload ===

  processChatFile(text: string) {
    this.chatFileError = null
    const result = parseSTChat(text)
    if (!result.success) {
      this.chatFileError = result.error
      this.chatParseResult = null
      return
    }
    this.chatParseResult = result

    // Auto-populate title from character name
    if (!this.storyTitle && result.characterName) {
      this.storyTitle = result.characterName
    }
  }

  clearChatFile() {
    this.chatParseResult = null
    this.chatFileError = null
  }

  async processCardFile(file: File) {
    this.cardFileError = null
    this.cardParsedData = null
    this.cardRawJson = null
    this.cardPortrait = null

    try {
      // Extract portrait from PNG before reading card data
      if (file.name.toLowerCase().endsWith('.png')) {
        const arrayBuffer = await file.arrayBuffer()
        const blob = new Blob([arrayBuffer], { type: 'image/png' })
        const reader = new FileReader()
        this.cardPortrait = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(blob)
        })
      }

      const jsonString = await readCharacterCardFile(file)
      this.cardRawJson = jsonString
      const parsed = parseCharacterCard(jsonString)

      if (!parsed) {
        this.cardFileError = 'Could not parse character card. Unsupported format.'
        return
      }

      this.cardParsedData = parsed

      // Extract embedded lorebook
      if (parsed.characterBook) {
        this.embeddedLorebookData = extractEmbeddedLorebook(parsed.characterBook, parsed.name)
      }

      // Auto-populate title from card name
      if (parsed.name && !this.storyTitle) {
        this.storyTitle = parsed.name
      }
    } catch (err) {
      this.cardFileError = err instanceof Error ? err.message : 'Failed to read character card'
    }
  }

  clearCardFile() {
    this.cardParsedData = null
    this.cardRawJson = null
    this.cardPortrait = null
    this.cardFileError = null
    this.embeddedLorebookData = null
    this.cardImportResult = null
    this.cardProcessError = null
  }

  // === Step 2: Import Selection & Processing ===

  async processCardImport() {
    if (!this.cardRawJson || this.isProcessingCard) return

    this.isProcessingCard = true
    this.cardProcessError = null

    try {
      const result = await convertCardToScenario(
        this.cardRawJson,
        this.selectedMode,
        this.selectedGenre,
      )

      this.cardImportResult = result

      if (!result.success && result.errors.length > 0) {
        this.cardProcessError = result.errors.join('; ')
      }

      // Apply selections
      if (this.importScenario && result.settingSeed) {
        this.settingSeed = result.settingSeed
      }

      if (this.importScenario && result.storyTitle) {
        this.storyTitle = result.storyTitle
      }

      if (this.importCharacters && result.npcs.length > 0) {
        this.supportingCharacters = [...result.npcs]
      }

      if (this.importCharacters && result.primaryCharacterName) {
        this.manualCharacterName = result.primaryCharacterName
      }

      // Add embedded lorebook
      if (this.importLorebook && this.embeddedLorebookData) {
        this.addEmbeddedLorebook()
      }
    } catch (err) {
      this.cardProcessError = err instanceof Error ? err.message : 'Failed to process character card'
    } finally {
      this.isProcessingCard = false
    }
  }

  private addEmbeddedLorebook() {
    if (!this.embeddedLorebookData) return

    const alreadyAdded = this.importedLorebooks.some(
      (lb) => lb.filename === this.embeddedLorebookData!.name,
    )
    if (alreadyAdded) return

    this.importedLorebooks = [
      ...this.importedLorebooks,
      {
        id: crypto.randomUUID(),
        filename: this.embeddedLorebookData.name,
        result: this.embeddedLorebookData.result,
        entries: this.embeddedLorebookData.result.entries,
        expanded: false,
      },
    ]
  }

  // === Step 3: Characters ===

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

  deleteSupportingCharacter(index: number) {
    this.supportingCharacters = this.supportingCharacters.filter((_, i) => i !== index)
  }

  // === Step 4: World & Lorebook ===

  useSettingAsIs() {
    if (!this.settingSeed.trim()) return
    this.expandedSetting = {
      name: this.settingSeed.split('.')[0].trim().slice(0, 50) || 'Custom Setting',
      description: this.settingSeed.trim(),
      keyLocations: [],
      atmosphere: '',
      themes: [],
      potentialConflicts: [],
    }
  }

  async expandSetting() {
    if (!this.settingSeed.trim() || this.isExpandingSetting) return

    this.isExpandingSetting = true
    this.settingError = null

    try {
      const lorebookContext =
        this.importedEntries.length > 0
          ? this.importedEntries.map((e) => ({
              name: e.name,
              type: e.type,
              description: e.description,
              hiddenInfo: undefined,
            }))
          : undefined

      this.expandedSetting = await scenarioService.expandSetting(
        this.settingSeed,
        this.selectedGenre,
        this.customGenre || undefined,
        settings.servicePresetAssignments['wizard:settingExpansion'],
        lorebookContext,
      )
    } catch (error) {
      this.settingError = error instanceof Error ? error.message : 'Failed to expand setting'
    } finally {
      this.isExpandingSetting = false
    }
  }

  addLorebookFromVault(vaultLorebook: VaultLorebook) {
    const entries = vaultLorebook.entries.map((e) => ({ ...e }))

    const baseMetadata = vaultLorebook.metadata || {
      format: 'aventura' as const,
      totalEntries: entries.length,
      entryBreakdown: { character: 0, location: 0, item: 0, faction: 0, concept: 0, event: 0 },
    }

    const metadata = {
      ...baseMetadata,
      importedEntries: entries.length,
      skippedEntries: 0,
    }

    const alreadyAdded = this.importedLorebooks.some((lb) => lb.vaultId === vaultLorebook.id)
    if (alreadyAdded) {
      ui.showToast('This lorebook is already imported', 'info')
      return
    }

    this.importedLorebooks = [
      ...this.importedLorebooks,
      {
        id: crypto.randomUUID(),
        vaultId: vaultLorebook.id,
        filename: vaultLorebook.name,
        result: {
          success: true,
          entries,
          errors: [],
          warnings: [],
          metadata,
        },
        entries,
        expanded: false,
      },
    ]
  }

  removeLorebook(id: string) {
    this.importedLorebooks = this.importedLorebooks.filter((lb) => lb.id !== id)
  }

  toggleLorebookExpanded(id: string) {
    this.importedLorebooks = this.importedLorebooks.map((lb) =>
      lb.id === id ? { ...lb, expanded: !lb.expanded } : lb,
    )
  }

  // === Step 6: Create Story ===

  async createStory() {
    if (!this.storyTitle.trim() || this.isCreatingStory) return

    this.isCreatingStory = true
    this.createError = null

    try {
      const protagonistName = this.protagonist?.name || 'the protagonist'

      // Build opening
      let opening: GeneratedOpening
      if (!this.importChatAsEntries && this.cardImportResult?.firstMessage) {
        // Fresh start: use card's first message as opening
        opening = {
          scene: replaceUserPlaceholders(this.cardImportResult.firstMessage, protagonistName),
          title: this.storyTitle,
          initialLocation: {
            name: 'Starting Location',
            description: 'The place where your journey begins.',
          },
        }
      } else if (this.importChatAsEntries && this.chatParseResult) {
        // Chat import: use first narration message as opening, or a placeholder
        const firstNarration = this.chatParseResult.messages.find((m) => m.type === 'narration')
        opening = {
          scene: firstNarration
            ? replaceUserPlaceholders(firstNarration.content, protagonistName)
            : 'The story begins...',
          title: this.storyTitle,
          initialLocation: {
            name: 'Starting Location',
            description: 'The place where your journey begins.',
          },
        }
      } else {
        opening = {
          scene: 'The story begins...',
          title: this.storyTitle,
          initialLocation: {
            name: 'Starting Location',
            description: 'The place where your journey begins.',
          },
        }
      }

      // Process placeholder replacements
      const processedSettingSeed = replaceUserPlaceholders(this.settingSeed, protagonistName)

      const processedCharacters = this.supportingCharacters.map((char) => ({
        ...char,
        name: replaceUserPlaceholders(char.name, protagonistName),
        description: replaceUserPlaceholders(char.description, protagonistName),
        role: char.role ? replaceUserPlaceholders(char.role, protagonistName) : '',
        relationship: char.relationship
          ? replaceUserPlaceholders(char.relationship, protagonistName)
          : '',
        traits: char.traits.map((t) => replaceUserPlaceholders(t, protagonistName)),
      }))

      const processedEntries = this.importedEntries.map((e) => ({
        ...e,
        name: replaceUserPlaceholders(e.name, protagonistName),
        description: replaceUserPlaceholders(e.description, protagonistName),
        keywords: e.keywords.map((k) => replaceUserPlaceholders(k, protagonistName)),
        aliases: e.aliases ?? [],
      }))

      // Build wizard data
      const wizardData: WizardData = {
        mode: this.selectedMode,
        genre: this.selectedGenre,
        customGenre: this.customGenre || undefined,
        settingSeed: processedSettingSeed,
        expandedSetting: this.expandedSetting || undefined,
        protagonist: this.protagonist || undefined,
        characters: processedCharacters.length > 0 ? processedCharacters : undefined,
        writingStyle: {
          pov: this.selectedPOV,
          tense: this.selectedTense,
          tone: this.tone,
        },
        title: this.storyTitle,
      }

      const storyData = await scenarioService.prepareStoryData(wizardData, opening)

      // Attach portrait
      if (storyData.protagonist && this.cardPortrait) {
        storyData.protagonist.portrait = this.cardPortrait
      }

      const newStory = await story.createStoryFromWizard({
        ...storyData,
        importedEntries: processedEntries.length > 0 ? processedEntries : undefined,
      })

      // Import chat messages as entries if selected
      if (this.importChatAsEntries && this.chatParseResult) {
        await story.loadStory(newStory.id)
        // Skip the first narration message since it was used as the opening scene
        const firstNarrationIndex = this.chatParseResult.messages.findIndex(
          (m) => m.type === 'narration',
        )
        const messagesToImport =
          firstNarrationIndex >= 0
            ? [
                ...this.chatParseResult.messages.slice(0, firstNarrationIndex),
                ...this.chatParseResult.messages.slice(firstNarrationIndex + 1),
              ]
            : this.chatParseResult.messages

        if (messagesToImport.length > 0) {
          await story.importSTChat(messagesToImport)
        }
      }

      // Save to vault if requested
      if (this.saveToVault && this.cardParsedData) {
        await this.saveImportToVault()
      }

      // Set default pack
      await database.setStoryPack(newStory.id, 'default-pack')

      await story.loadStory(newStory.id)
      ui.setActivePanel('story')
      this.onClose()
    } catch (err) {
      console.error('Failed to create story from ST import:', err)
      this.createError = err instanceof Error ? err.message : 'Failed to create story'
    } finally {
      this.isCreatingStory = false
    }
  }

  private async saveImportToVault() {
    if (!this.cardParsedData) return

    try {
      // Save character to vault
      if (this.protagonist) {
        if (!characterVault.isLoaded) await characterVault.load()
        await characterVault.add({
          name: this.protagonist.name,
          description: this.protagonist.description || null,
          traits: this.protagonist.traits || [],
          visualDescriptors: {},
          portrait: this.cardPortrait,
          tags: [],
          favorite: false,
          source: 'import',
          originalStoryId: null,
          metadata: {
            background: this.protagonist.background || null,
            motivation: this.protagonist.motivation || null,
          },
        })
      }

      // Save scenario to vault
      if (this.cardImportResult) {
        if (!scenarioVault.isLoaded) await scenarioVault.load()
        await scenarioVault.add({
          name: this.storyTitle || this.cardParsedData.name,
          description: null,
          settingSeed: this.settingSeed,
          npcs: this.supportingCharacters.map((c) => ({
            name: c.name,
            role: c.role || 'supporting',
            description: c.description,
            relationship: c.relationship || '',
            traits: c.traits || [],
          })),
          primaryCharacterName: this.protagonist?.name || this.cardParsedData.name,
          firstMessage: this.cardImportResult.firstMessage || null,
          alternateGreetings: this.cardImportResult.alternateGreetings || [],
          tags: [],
          favorite: false,
          source: 'import',
          originalFilename: null,
          metadata: {},
        })
      }
    } catch (err) {
      console.error('Failed to save to vault:', err)
      // Non-fatal — story was already created
    }
  }
}
