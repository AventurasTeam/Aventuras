import { story } from '$lib/stores/story.svelte'
import { ui } from '$lib/stores/ui.svelte'
import { settings } from '$lib/stores/settings.svelte'
import { scenarioService, type WizardData } from '$lib/services/ai/wizard/ScenarioService'
import {
  parseSTChat,
  type STChatParseResult,
  type STChatMessage,
} from '$lib/services/stChatImporter'
import { CharacterCardImport } from '$lib/services/characterCardImport'
import { LorebookImportExport } from '$lib/services/lorebookImportExport'
import { replaceUserPlaceholders } from '$lib/components/wizard/wizardTypes'
import type { ImportedLorebookItem } from '$lib/components/wizard/wizardTypes'
import type { StoryMode, POV, VaultCharacter, VaultLorebook, VaultLorebookEntry } from '$lib/types'
import type {
  ExpandedSetting,
  GeneratedCharacter,
  GeneratedOpening,
  GeneratedProtagonist,
} from '$lib/services/ai/sdk'
import type { Genre, Tense } from '$lib/services/ai/wizard/ScenarioService'
import { scenarioVault } from '$lib/stores/scenarioVault.svelte'
import { database } from '$lib/services/database'
import { ImageStore } from '$lib/stores/wizard/imageStore.svelte'
import { SvelteMap } from 'svelte/reactivity'
import { packService } from '$lib/services/packs/pack-service'
import type { PresetPack, CustomVariable } from '$lib/services/packs/types'

export class STImportWizardStore {
  // Step navigation
  currentStep = $state(1)
  totalSteps = 8

  // Portrait generation/upload (Step 6)
  image = new ImageStore()

  // Step 1: File Uploads
  chatParseResult = $state<STChatParseResult | null>(null)
  chatFileError = $state<string | null>(null)

  // Pack selection
  selectedPackId = $state<string>('default-pack')
  availablePacks = $state<PresetPack[]>([])
  packVariables = $state<CustomVariable[]>([])
  customVariableValues = $state<Record<string, string>>({})
  packsLoaded = $state(false)

  cardParsedData = $state<CharacterCardImport.ParsedCard | null>(null)
  cardRawJson = $state<string | null>(null)
  cardPortrait = $state<string | null>(null) // base64 data URL from PNG
  cardFileError = $state<string | null>(null)

  // Step 2: Import Selection
  importCharacters = $state(true)
  importScenario = $state(true)
  importLorebook = $state(true)
  isProcessingCard = $state(false)
  cardImportResult = $state<CharacterCardImport.CardImportResult | null>(null)
  cardSanitized = $state<CharacterCardImport.SanitizedCharacter | null>(null)
  cardProcessError = $state<string | null>(null)

  embeddedLorebookData = $state<{
    name: string
    entries: VaultLorebookEntry[]
    result: LorebookImportExport.LorebookImportResult
  } | null>(null)

  // Step 3: Characters
  protagonist = $state<GeneratedProtagonist | null>(null)
  protagonistPortrait = $state<string | null>(null)
  manualCharacterName = $state('')
  manualCharacterDescription = $state('')
  manualCharacterBackground = $state('')
  manualCharacterMotivation = $state('')
  manualCharacterTraits = $state('')
  showManualInput = $state(true)
  showVaultPicker = $state(false)
  supportingCharacters = $state<GeneratedCharacter[]>([])
  cardCharacterName = $state('')
  characterPortraits = $state<SvelteMap<string, string>>(new SvelteMap())

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
  visualProseMode = $state(false)
  imageGenerationMode = $state<'none' | 'agentic' | 'inline'>('none')
  backgroundImagesEnabled = $state(false)
  referenceMode = $state(false)
  importChatAsEntries = $state(false) // true = import chat, false = fresh start with card opening

  // Step 6: Review
  storyTitle = $state('')
  isCreatingStory = $state(false)
  createError = $state<string | null>(null)
  saveToVault = $state(false)
  vaultTag = $state('')
  vaultDescription = $state('')

  // Callback
  onClose: () => void

  constructor(onClose: () => void) {
    this.onClose = onClose
    void this.loadPacks()
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

  // === Pack Selection ===

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

  canProceed(): boolean {
    switch (this.currentStep) {
      case 1: // Prompt Pack
        return this.allVariablesFilled()
      case 2: // Upload Files
        return this.cardParsedData !== null
      case 3: // Import Selection
        return !this.isProcessingCard
      case 4: // Characters
        return this.protagonist !== null
      case 5: // World & Lorebook
        return this.settingSeed.trim().length > 0
      case 6: // Writing Style
        return true
      case 7: // Portraits (optional)
        return true
      case 8: // Review
        return this.storyTitle.trim().length > 0
      default:
        return false
    }
  }

  nextStep() {
    if (this.currentStep < this.totalSteps && this.canProceed()) {
      if (this.currentStep === 6) this.syncToImageStore()
      if (this.currentStep === 7) this.syncFromImageStore()
      this.currentStep++
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      if (this.currentStep === 7) this.syncFromImageStore()
      this.currentStep--
    }
  }

  private syncToImageStore() {
    // Protagonist portrait
    if (this.protagonistPortrait) {
      this.image.protagonistPortrait = this.protagonistPortrait
    }
    // Protagonist visual descriptors from character data (only if empty)
    if (this.protagonist && !this.image.protagonistVisualDescriptors) {
      this.image.protagonistVisualDescriptors = this.protagonist.description || ''
    }
    // Supporting character portraits
    for (const [name, portrait] of this.characterPortraits) {
      if (portrait) {
        this.image.supportingCharacterPortraits[name] = portrait
      }
    }
    this.image.supportingCharacterPortraits = { ...this.image.supportingCharacterPortraits }
    // Supporting character visual descriptors (only if empty for each)
    for (const char of this.supportingCharacters) {
      if (!this.image.supportingCharacterVisualDescriptors[char.name]) {
        this.image.supportingCharacterVisualDescriptors[char.name] = char.description || ''
      }
    }
    this.image.supportingCharacterVisualDescriptors = {
      ...this.image.supportingCharacterVisualDescriptors,
    }
  }

  private syncFromImageStore() {
    // Sync protagonist portrait back
    this.protagonistPortrait = this.image.protagonistPortrait
    // Sync supporting character portraits back
    const map = new SvelteMap<string, string>()
    for (const [name, portrait] of Object.entries(this.image.supportingCharacterPortraits)) {
      if (portrait) {
        map.set(name, portrait)
      }
    }
    this.characterPortraits = map
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
    this.importChatAsEntries = true

    // Auto-populate title from character name
    if (!this.storyTitle && result.characterName) {
      this.storyTitle = result.characterName
    }
  }

  clearChatFile() {
    this.chatParseResult = null
    this.chatFileError = null
    this.importChatAsEntries = false
  }

  async processCardFile(file: File) {
    this.cardFileError = null
    this.cardParsedData = null
    this.cardRawJson = null
    this.cardPortrait = null

    try {
      // Extract portrait from PNG before reading card data
      if (file.name.toLowerCase().endsWith('.png')) {
        const reader = new FileReader()
        this.cardPortrait = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })
      }

      const jsonString = await CharacterCardImport.readFile(file)
      this.cardRawJson = jsonString
      const parsed = CharacterCardImport.parseJson(jsonString)

      if (!parsed) {
        this.cardFileError = 'Could not parse character card. Unsupported format.'
        return
      }

      this.cardParsedData = parsed

      // Extract embedded lorebook
      if (parsed.characterBook) {
        this.embeddedLorebookData = LorebookImportExport.extractEmbeddedLorebook(
          parsed.characterBook,
          parsed.name,
        )
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
    this.cardSanitized = null
    this.cardProcessError = null
  }

  // === Step 2: Import Selection & Processing ===

  async processCardImport() {
    if (!this.cardRawJson || !this.cardParsedData || this.isProcessingCard) return

    this.isProcessingCard = true
    this.cardProcessError = null

    try {
      // Run scenario extraction and character sanitization in parallel
      const [result, sanitized] = await Promise.all([
        CharacterCardImport.clean(this.cardRawJson, this.selectedGenre),
        CharacterCardImport.sanitize(this.cardRawJson),
      ])

      this.cardImportResult = result
      this.cardSanitized = sanitized

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

      if (this.importCharacters) {
        // Use sanitized data for clean character info, fallback to raw parsed data
        const charName = sanitized?.name || result.primaryCharacterName || this.cardParsedData.name
        const cardChar: GeneratedCharacter = {
          name: charName,
          description:
            sanitized?.description ||
            this.cardParsedData?.description ||
            'A character from the imported card.',
          role: 'primary',
          relationship: '',
          traits: sanitized?.traits?.slice(0, 8) || [],
        }
        this.cardCharacterName = cardChar.name
        // Attach card portrait to the primary character
        if (this.cardPortrait) {
          this.characterPortraits = new SvelteMap(this.characterPortraits).set(
            cardChar.name,
            this.cardPortrait,
          )
        }
        // Filter out NPCs that duplicate the primary card character
        const dedupedNpcs = result.npcs.filter(
          (npc) => npc.name.toLowerCase() !== cardChar.name.toLowerCase(),
        )
        this.supportingCharacters = [cardChar, ...dedupedNpcs]
      }

      // Add embedded lorebook
      if (this.importLorebook && this.embeddedLorebookData) {
        this.addEmbeddedLorebook()
      }
    } catch (err) {
      this.cardProcessError =
        err instanceof Error ? err.message : 'Failed to process character card'
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

  selectProtagonistFromVault(character: VaultCharacter) {
    this.protagonist = {
      name: character.name,
      description: character.description || '',
      background: (character.metadata as Record<string, string>)?.background || '',
      motivation: (character.metadata as Record<string, string>)?.motivation || '',
      traits: character.traits || [],
    }
    this.protagonistPortrait = character.portrait || null
    this.manualCharacterName = character.name
    this.manualCharacterDescription = character.description || ''
    this.manualCharacterBackground =
      (character.metadata as Record<string, string>)?.background || ''
    this.manualCharacterMotivation =
      (character.metadata as Record<string, string>)?.motivation || ''
    this.manualCharacterTraits = (character.traits || []).join(', ')
    this.showManualInput = false
    this.showVaultPicker = false
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

  updateProtagonist(protagonist: GeneratedProtagonist, portrait: string | null) {
    this.protagonist = protagonist
    this.protagonistPortrait = portrait
  }

  deleteSupportingCharacter(index: number) {
    this.supportingCharacters = this.supportingCharacters.filter((_, i) => i !== index)
  }

  updateSupportingCharacter(index: number, char: GeneratedCharacter) {
    this.supportingCharacters = this.supportingCharacters.map((c, i) => (i === index ? char : c))
  }

  updateCharacterPortrait(name: string, portrait: string | null) {
    const map = new SvelteMap(this.characterPortraits)
    if (portrait) {
      map.set(name, portrait)
    } else {
      map.delete(name)
    }
    this.characterPortraits = map
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

      // Find the first narration message index once for reuse
      const firstNarrationIndex =
        this.importChatAsEntries && this.chatParseResult
          ? this.chatParseResult.messages.findIndex((m) => m.type === 'narration')
          : -1
      const firstNarration =
        firstNarrationIndex !== -1 ? this.chatParseResult!.messages[firstNarrationIndex] : undefined

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
          visualProseMode: this.visualProseMode,
          imageGenerationMode: this.imageGenerationMode,
          backgroundImagesEnabled: this.backgroundImagesEnabled,
          referenceMode: this.referenceMode,
        },
        title: this.storyTitle,
      }

      const storyData = await scenarioService.prepareStoryData(wizardData, opening)

      // Use user-provided tag and description from the wizard
      if (this.vaultTag.trim()) {
        storyData.genre = this.vaultTag.trim()
      }
      if (this.vaultDescription.trim()) {
        storyData.description = this.vaultDescription.trim()
      }

      // Attach protagonist portrait (from vault, not from card)
      if (storyData.protagonist && this.protagonistPortrait) {
        storyData.protagonist.portrait = this.protagonistPortrait
      }

      // Attach portraits to supporting characters
      for (const char of storyData.characters) {
        if (char.name && this.characterPortraits.has(char.name)) {
          char.portrait = this.characterPortraits.get(char.name)!
        }
      }

      const newStory = await story.createStoryFromWizard({
        ...storyData,
        importedEntries: processedEntries.length > 0 ? processedEntries : undefined,
      })

      // Import chat messages as entries if selected
      if (this.importChatAsEntries && this.chatParseResult) {
        await story.loadStory(newStory.id)
        // Skip the first narration message since it was used as the opening scene
        const messagesToImport =
          firstNarrationIndex !== -1
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

      // Set pack
      await database.setStoryPack(newStory.id, this.selectedPackId)
      if (Object.keys(this.customVariableValues).length > 0) {
        await database.setStoryCustomVariables(newStory.id, this.customVariableValues)
      }

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
      // Save scenario to vault
      if (this.cardImportResult) {
        if (!scenarioVault.isLoaded) await scenarioVault.load()
        const tags = this.vaultTag.trim() ? [this.vaultTag.trim()] : []
        await scenarioVault.add({
          name: this.storyTitle || this.cardParsedData.name,
          description: this.vaultDescription.trim() || null,
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
          tags,
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
