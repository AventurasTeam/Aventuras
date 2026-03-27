import { scenarioService, type Genre } from '$lib/services/ai/wizard/ScenarioService'
import { type ExpandedSetting } from '$lib/services/ai/sdk'
import { aiService } from '$lib/services/ai'
import { TranslationService } from '$lib/services/ai/utils/TranslationService'
import { settings } from '$lib/stores/settings.svelte'
import { scenarioVault } from '$lib/stores/scenarioVault.svelte'
import { LorebookImportExport } from '$lib/services/lorebookImportExport'
import type { GeneratedCharacter } from '$lib/services/ai/sdk'

export class SettingStore {
  settingSeed = $state('')
  expandedSetting = $state<ExpandedSetting | null>(null)
  expandedSettingTranslated = $state<ExpandedSetting | null>(null)
  isExpandingSetting = $state(false)
  isRefiningSetting = $state(false)
  settingError = $state<string | null>(null)
  settingElaborationGuidance = $state('')
  previousExpandedSetting = $state<ExpandedSetting | null>(null)
  previousSettingSeed = $state('')
  isEditingSetting = $state(false)

  // Scenario Selection
  selectedScenarioId = $state<string | null>(null)

  // Vault Integration
  showScenarioVaultPicker = $state(false)
  savedScenarioToVaultConfirm = $state(false)

  // Derived
  expandedSettingDisplay = $derived<ExpandedSetting | null>(
    this.expandedSettingTranslated ?? this.expandedSetting,
  )

  // Actions
  clearSettingEditState() {
    this.isEditingSetting = false
    this.previousExpandedSetting = null
    this.previousSettingSeed = ''
  }

  cancelSettingEdit() {
    if (!this.isEditingSetting) return
    this.expandedSetting = this.previousExpandedSetting
    this.settingSeed = this.previousSettingSeed
    this.clearSettingEditState()
  }

  useSettingAsIs() {
    if (!this.settingSeed.trim()) return
    this.clearSettingEditState()
    this.expandedSetting = {
      name: this.settingSeed.split('.')[0].trim().slice(0, 50) || 'Custom Setting',
      description: this.settingSeed.trim(),
      keyLocations: [],
      atmosphere: '',
      themes: [],
      potentialConflicts: [],
    }
  }

  editSetting() {
    if (!this.expandedSetting) return
    this.previousExpandedSetting = this.expandedSetting
    this.previousSettingSeed = this.settingSeed
    this.isEditingSetting = true
    this.settingSeed = this.expandedSetting.description
    this.expandedSetting = null
  }

  async expandSetting(
    selectedGenre: Genre,
    customGenre: string,
    importedEntries: LorebookImportExport.ImportedEntry[] = [],
    seedOverride?: string,
  ) {
    const seed = seedOverride ?? this.settingSeed
    if (!seed.trim() || this.isExpandingSetting) return

    this.isExpandingSetting = true
    this.settingError = null

    try {
      const lorebookContext =
        importedEntries.length > 0
          ? importedEntries.map((e) => ({
              name: e.name,
              type: e.type,
              description: e.description,
              hiddenInfo: undefined,
            }))
          : undefined

      this.expandedSetting = await scenarioService.expandSetting(
        seed,
        selectedGenre,
        customGenre || undefined,
        settings.servicePresetAssignments['wizard:settingExpansion'],
        lorebookContext,
        this.settingElaborationGuidance.trim() || undefined,
      )
      this.clearSettingEditState()
      this.settingElaborationGuidance = ''

      await this.translateSetting()
    } catch (error) {
      console.error('Failed to expand setting:', error)
      this.settingError = error instanceof Error ? error.message : 'Failed to expand setting'
    } finally {
      this.isExpandingSetting = false
    }
  }

  async expandSettingFurther(
    selectedGenre: Genre,
    customGenre: string,
    importedEntries: LorebookImportExport.ImportedEntry[] = [],
  ) {
    if (!this.expandedSetting || this.isRefiningSetting) return

    this.isRefiningSetting = true
    this.settingError = null

    try {
      const lorebookContext =
        importedEntries.length > 0
          ? importedEntries.map((e) => ({
              name: e.name,
              type: e.type,
              description: e.description,
              hiddenInfo: undefined,
            }))
          : undefined

      this.expandedSetting = await scenarioService.refineSetting(
        this.expandedSetting,
        selectedGenre,
        customGenre || undefined,
        settings.servicePresetAssignments['wizard:settingRefinement'],
        lorebookContext,
        this.settingElaborationGuidance.trim() || undefined,
      )
      this.clearSettingEditState()
      this.settingElaborationGuidance = ''

      await this.translateSetting()
    } catch (error) {
      console.error('Failed to refine setting:', error)
      this.settingError = error instanceof Error ? error.message : 'Failed to refine setting'
    } finally {
      this.isRefiningSetting = false
    }
  }

  async translateSetting() {
    const translationSettings = settings.translationSettings
    if (this.expandedSetting && TranslationService.shouldTranslate(translationSettings)) {
      try {
        this.expandedSettingTranslated = await this.translateExpandedSetting(
          this.expandedSetting,
          translationSettings.targetLanguage,
        )
      } catch (translationError) {
        console.error('Setting translation failed (non-fatal):', translationError)
        this.expandedSettingTranslated = null
      }
    } else {
      this.expandedSettingTranslated = null
    }
  }

  private async translateExpandedSetting(
    setting: ExpandedSetting,
    targetLanguage: string,
  ): Promise<ExpandedSetting> {
    const fields: Record<string, string> = {
      name: setting.name,
      description: setting.description,
    }

    if (setting.atmosphere) fields.atmosphere = setting.atmosphere
    if (setting.themes?.length) fields.themes = setting.themes.join(', ')
    if (setting.potentialConflicts?.length) fields.conflicts = setting.potentialConflicts.join('; ')
    ;(setting.keyLocations || []).forEach((loc, i) => {
      fields[`loc_${i}_name`] = loc.name
      if (loc.description) fields[`loc_${i}_desc`] = loc.description
    })

    const translated = await aiService.translateWizardBatch(fields, targetLanguage)

    const translatedLocations = (setting.keyLocations || []).map((loc, i) => ({
      name: translated[`loc_${i}_name`] || loc.name,
      description: translated[`loc_${i}_desc`] || loc.description,
    }))

    return {
      ...setting,
      name: translated.name || setting.name,
      description: translated.description || setting.description,
      atmosphere: translated.atmosphere || setting.atmosphere,
      keyLocations: translatedLocations,
      themes: translated.themes
        ? translated.themes
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : setting.themes,
      potentialConflicts: translated.conflicts
        ? translated.conflicts
            .split(';')
            .map((c) => c.trim())
            .filter(Boolean)
        : setting.potentialConflicts,
    }
  }

  async saveScenarioToVault(
    storyTitle: string,
    supportingCharacters: GeneratedCharacter[],
    cardImportedFirstMessage: string | null,
    cardImportedAlternateGreetings: string[],
  ) {
    if (!this.settingSeed.trim()) return

    if (!scenarioVault.isLoaded) {
      await scenarioVault.load()
    }

    const vaultNpcs = supportingCharacters.map((c) => ({
      name: c.name,
      role: c.role || 'supporting',
      description: c.description,
      relationship: c.relationship || '',
      traits: c.traits || [],
    }))

    await scenarioVault.saveFromWizard(
      storyTitle || 'Untitled Scenario',
      this.settingSeed,
      vaultNpcs,
      {
        description: this.expandedSetting?.description,
        firstMessage: cardImportedFirstMessage || undefined,
        alternateGreetings: cardImportedAlternateGreetings,
        tags: ['wizard'],
      },
    )

    this.savedScenarioToVaultConfirm = true
    setTimeout(() => (this.savedScenarioToVaultConfirm = false), 2000)
  }
}
