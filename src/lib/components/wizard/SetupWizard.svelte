<script lang="ts">
  import { settings } from '$lib/stores/settings.svelte'
  import { WizardStore } from '$lib/stores/wizard/wizard.svelte'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { ChevronLeft, ChevronRight, Sparkles, Play } from 'lucide-svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { lorebookVault } from '$lib/stores/lorebookVault.svelte'
  import { characterVault } from '$lib/stores/characterVault.svelte'
  import { hasRequiredCredentials } from '$lib/services/ai/image'
  import type { VaultCharacter } from '$lib/types'

  // Step components
  import {
    Step1Mode,
    StepPackSelection,
    Step2Lorebook,
    Step3Setting,
    Step4Characters,
    Step5SupportingCast,
    Step6Portraits,
    Step7WritingStyle,
    Step8Opening,
  } from './steps'

  interface Props {
    onClose: () => void
  }

  let { onClose }: Props = $props()

  // Initialize Wizard Store
  const wizard = new WizardStore(() => onClose())

  // Auto-link embedded lorebook when selecting a vault character
  function autoLinkCharacterLorebook(char: VaultCharacter, isProtagonist = false) {
    const linkedId = (char.metadata as Record<string, unknown>)?.linkedLorebookId as
      | string
      | undefined
    if (!linkedId) return
    if (isProtagonist) wizard.setProtagonistLinkedLorebook(linkedId)
    const lorebook = lorebookVault.getById(linkedId)
    if (!lorebook) return
    const alreadyAdded = wizard.narrative.importedLorebooks.some((lb) => lb.vaultId === linkedId)
    if (alreadyAdded) return
    wizard.narrative.addLorebookFromVault(lorebook)
    ui.showToast(`Added embedded lorebook: ${lorebook.name}`, 'info')
  }

  // Resolve linkedLorebookId from a vault character ID
  function getLinkedLorebookIdFromVaultCharacter(vaultCharId: string): string | undefined {
    const char = characterVault.getById(vaultCharId)
    if (!char) return undefined
    return (char.metadata as Record<string, unknown>)?.linkedLorebookId as string | undefined
  }

  // Check if API key is configured
  const needsApiKey = $derived(settings.needsApiKey)

  // Check if image generation is enabled and configured
  const imageGenerationEnabled = $derived.by(() => {
    return hasRequiredCredentials()
  })

  // Step Titles
  const stepTitles = [
    'Choose Your Mode',
    'Prompt Pack',
    'World & Setting',
    'Create Your Character',
    'Supporting Cast (Optional)',
    'Import Lorebook (Optional)',
    'Character Portraits (Optional)',
    'Writing Style',
    'Generate Opening',
  ]

  // Load packs when entering step 2
  $effect(() => {
    if (wizard.currentStep === 2) {
      wizard.loadPacks()
    }
  })
</script>

<ResponsiveModal.Root open={true} onOpenChange={(open) => !open && onClose()}>
  <ResponsiveModal.Content
    class="flex h-full flex-col gap-0 p-0 sm:h-auto sm:max-h-[90vh] sm:max-w-3xl"
  >
    <!-- Header -->
    <div class="flex flex-col border-b p-4 pb-4">
      <div class="mb-4 flex items-center justify-between">
        <div>
          <ResponsiveModal.Title class="text-xl">Create New Story</ResponsiveModal.Title>
          <ResponsiveModal.Description>
            Step {wizard.currentStep} of {wizard.totalSteps}: {stepTitles[wizard.currentStep - 1]}
          </ResponsiveModal.Description>
        </div>
      </div>

      <!-- Progress Bar -->
      <div class="flex gap-1">
        {#each Array(wizard.totalSteps) as _, i (i)}
          <div
            class="h-1.5 flex-1 rounded-full transition-colors {i === wizard.currentStep - 1
              ? 'bg-primary'
              : ''} {i < wizard.currentStep - 1 ? 'bg-primary/40' : ''} {i > wizard.currentStep - 1
              ? 'bg-muted'
              : ''}"
          ></div>
        {/each}
      </div>
    </div>

    <!-- Content -->
    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      {#if needsApiKey}
        <!-- API Key Warning -->
        <div class="flex flex-col items-center justify-center py-8 text-center">
          <div class="mb-4 rounded-full bg-amber-500/20 p-4">
            <Sparkles class="h-8 w-8 text-amber-400" />
          </div>
          <h3 class="mb-2 text-lg font-semibold">API Key Required</h3>
          <p class="text-muted-foreground mb-4 max-w-md">
            The setup wizard uses AI to dynamically generate your story world. Please configure your
            OpenRouter API key in settings first.
          </p>
          <Button
            onclick={() => {
              ui.openSettings()
              onClose()
            }}
          >
            Open Settings
          </Button>
        </div>
      {:else if wizard.currentStep === 1}
        <Step1Mode
          selectedMode={wizard.narrative.selectedMode}
          onModeChange={(mode) => (wizard.narrative.selectedMode = mode)}
        />
      {:else if wizard.currentStep === 2}
        <StepPackSelection
          availablePacks={wizard.availablePacks}
          selectedPackId={wizard.selectedPackId}
          packVariables={wizard.packVariables}
          variableValues={wizard.customVariableValues}
          onSelectPack={(packId) => wizard.selectPack(packId)}
          onVariableChange={(name, value) => wizard.setVariableValue(name, value)}
        />
      {:else if wizard.currentStep === 3}
        <Step3Setting
          settingSeed={wizard.setting.settingSeed}
          expandedSetting={wizard.setting.expandedSettingDisplay}
          settingElaborationGuidance={wizard.setting.settingElaborationGuidance}
          isExpandingSetting={wizard.setting.isExpandingSetting}
          isRefiningSetting={wizard.setting.isRefiningSetting}
          settingError={wizard.setting.settingError}
          isEditingSetting={wizard.setting.isEditingSetting}
          selectedScenarioId={wizard.setting.selectedScenarioId}
          importedCardNpcs={wizard.character.importedCardNpcs}
          cardImportError={wizard.character.cardImportError}
          isImportingCard={wizard.character.isImportingCard}
          savedScenarioToVaultConfirm={wizard.setting.savedScenarioToVaultConfirm}
          showScenarioVaultPicker={wizard.setting.showScenarioVaultPicker}
          customGenre={wizard.narrative.customGenre}
          onSettingSeedChange={(v) => (wizard.setting.settingSeed = v)}
          onGuidanceChange={(v) => (wizard.setting.settingElaborationGuidance = v)}
          onCustomGenreChange={(v) => wizard.narrative.setCustomGenre(v)}
          onUseAsIs={() => wizard.setting.useSettingAsIs()}
          onExpandSetting={() =>
            wizard.setting.expandSetting(
              wizard.narrative.selectedGenre,
              wizard.narrative.customGenre,
              wizard.narrative.importedEntries,
            )}
          onExpandFurther={() =>
            wizard.setting.expandSettingFurther(
              wizard.narrative.selectedGenre,
              wizard.narrative.customGenre,
              wizard.narrative.importedEntries,
            )}
          onEditSetting={() => wizard.setting.editSetting()}
          onCancelEdit={() => wizard.setting.cancelSettingEdit()}
          onSelectScenario={(id) => wizard.selectScenario(id)}
          onClearCardImport={() => {
            wizard.clearScenarioLinkedLorebook()
            wizard.character.clearCardImport()
          }}
          onSaveToVault={() =>
            wizard.setting.saveScenarioToVault(
              wizard.narrative.storyTitle,
              wizard.character.supportingCharacters,
              wizard.character.cardImportedFirstMessage,
              wizard.character.cardImportedAlternateGreetings,
            )}
          onShowVaultPickerChange={(show) => (wizard.setting.showScenarioVaultPicker = show)}
          onSelectFromVault={(s) => wizard.selectScenarioFromVault(s)}
          cardImportFileInputRef={(el) => (wizard.character.cardImportFileInput = el)}
          scenarioCarouselRef={() => {
            /* managed locally if needed, or in store */
          }}
          onCarouselScroll={() => {
            /* managed locally */
          }}
          onNavigateToVault={() => {
            ui.setActivePanel('vault')
            ui.setVaultTab('scenarios')
            onClose()
          }}
        />
      {:else if wizard.currentStep === 4}
        <Step4Characters
          selectedMode={wizard.narrative.selectedMode}
          expandedSetting={wizard.setting.expandedSettingDisplay}
          protagonist={wizard.character.protagonistDisplay}
          manualCharacterName={wizard.character.manualCharacterName}
          manualCharacterDescription={wizard.character.manualCharacterDescription}
          manualCharacterBackground={wizard.character.manualCharacterBackground}
          manualCharacterMotivation={wizard.character.manualCharacterMotivation}
          manualCharacterTraits={wizard.character.manualCharacterTraits}
          characterElaborationGuidance={wizard.character.characterElaborationGuidance}
          isGeneratingProtagonist={wizard.character.isGeneratingProtagonist}
          isExpandingCharacter={wizard.character.isExpandingCharacter}
          isRefiningCharacter={wizard.character.isRefiningCharacter}
          protagonistError={wizard.character.protagonistError}
          savedToVaultConfirm={wizard.character.savedToVaultConfirm}
          onManualNameChange={(v) => (wizard.character.manualCharacterName = v)}
          onManualDescriptionChange={(v) => (wizard.character.manualCharacterDescription = v)}
          onManualBackgroundChange={(v) => (wizard.character.manualCharacterBackground = v)}
          onManualMotivationChange={(v) => (wizard.character.manualCharacterMotivation = v)}
          onManualTraitsChange={(v) => (wizard.character.manualCharacterTraits = v)}
          onCharacterGuidanceChange={(v) => (wizard.character.characterElaborationGuidance = v)}
          onUseManualCharacter={() => wizard.character.useManualCharacter()}
          onElaborateCharacter={() =>
            wizard.character.elaborateCharacter(
              wizard.setting.expandedSetting,
              wizard.narrative.selectedGenre,
              wizard.narrative.customGenre,
            )}
          onElaborateCharacterFurther={() =>
            wizard.character.elaborateCharacterFurther(
              wizard.setting.expandedSetting,
              wizard.narrative.selectedGenre,
              wizard.narrative.customGenre,
            )}
          onGenerateProtagonist={() =>
            wizard.character.generateProtagonist(
              wizard.setting.expandedSetting!,
              wizard.narrative.selectedGenre,
              wizard.narrative.selectedMode,
              wizard.narrative.selectedPOV,
              wizard.narrative.customGenre,
            )}
          onSaveToVault={() =>
            wizard.character.handleSaveProtagonistToVault(
              wizard.image.protagonistVisualDescriptors,
              wizard.image.protagonistPortrait,
            )}
          onSelectProtagonistFromVault={(c) => {
            wizard.character.handleSelectProtagonistFromVault(
              c,
              (v) => (wizard.image.protagonistVisualDescriptors = v),
              (v) => (wizard.image.protagonistPortrait = v),
            )
            autoLinkCharacterLorebook(c, true)
          }}
          onNavigateToVault={() => {
            ui.setActivePanel('vault')
            ui.setVaultTab('characters')
            onClose()
          }}
        />
      {:else if wizard.currentStep === 5}
        <Step5SupportingCast
          protagonist={wizard.character.protagonistDisplay}
          supportingCharacters={wizard.character.supportingCharactersDisplay}
          showSupportingCharacterForm={wizard.character.showSupportingCharacterForm}
          editingSupportingCharacterIndex={wizard.character.editingSupportingCharacterIndex}
          supportingCharacterName={wizard.character.supportingCharacterName}
          supportingCharacterRole={wizard.character.supportingCharacterRole}
          supportingCharacterDescription={wizard.character.supportingCharacterDescription}
          supportingCharacterRelationship={wizard.character.supportingCharacterRelationship}
          supportingCharacterTraits={wizard.character.supportingCharacterTraits}
          supportingCharacterGuidance={wizard.character.supportingCharacterGuidance}
          isGeneratingCharacters={wizard.character.isGeneratingCharacters}
          isElaboratingSupportingCharacter={wizard.character.isElaboratingSupportingCharacter}
          onSupportingNameChange={(v) => (wizard.character.supportingCharacterName = v)}
          onSupportingRoleChange={(v) => (wizard.character.supportingCharacterRole = v)}
          onSupportingDescriptionChange={(v) =>
            (wizard.character.supportingCharacterDescription = v)}
          onSupportingRelationshipChange={(v) =>
            (wizard.character.supportingCharacterRelationship = v)}
          onSupportingTraitsChange={(v) => (wizard.character.supportingCharacterTraits = v)}
          onSupportingGuidanceChange={(v) => (wizard.character.supportingCharacterGuidance = v)}
          onOpenSupportingForm={() => wizard.character.openSupportingCharacterForm()}
          onEditSupportingCharacter={(i) => wizard.character.editSupportingCharacter(i)}
          onCancelSupportingForm={() => wizard.character.cancelSupportingCharacterForm()}
          onUseSupportingAsIs={() => wizard.character.useSupportingCharacterAsIs()}
          onElaborateSupportingCharacter={() =>
            wizard.character.elaborateSupportingCharacter(
              wizard.setting.expandedSetting,
              wizard.narrative.selectedGenre,
              wizard.narrative.customGenre,
            )}
          onDeleteSupportingCharacter={(i) => {
            const char = wizard.character.supportingCharacters[i]
            if (char?.vaultId) {
              const linkedId = getLinkedLorebookIdFromVaultCharacter(char.vaultId)
              if (linkedId) wizard._removeLinkedLorebook(linkedId)
            }
            wizard.character.deleteSupportingCharacter(i)
          }}
          onGenerateCharacters={() =>
            wizard.character.generateCharacters(
              wizard.setting.expandedSetting!,
              wizard.narrative.selectedGenre,
              wizard.narrative.customGenre,
            )}
          onSelectSupportingFromVault={(c) => {
            wizard.character.handleSelectSupportingFromVault(
              c,
              (name, v) => (wizard.image.supportingCharacterVisualDescriptors[name] = v),
              (name, v) => (wizard.image.supportingCharacterPortraits[name] = v),
            )
            autoLinkCharacterLorebook(c)
          }}
          onNavigateToVault={() => {
            ui.setActivePanel('vault')
            ui.setVaultTab('characters')
            onClose()
          }}
        />
      {:else if wizard.currentStep === 6}
        <Step2Lorebook
          importedLorebooks={wizard.narrative.importedLorebooks}
          importError={wizard.narrative.importError}
          onSelectFromVault={(l) => wizard.narrative.addLorebookFromVault(l)}
          onRemoveLorebook={(id) => wizard.narrative.removeLorebook(id)}
          onToggleExpanded={(id) => wizard.narrative.toggleLorebookExpanded(id)}
          onClearAll={() => wizard.narrative.clearAllLorebooks()}
          onNavigateToVault={() => {
            ui.setActivePanel('vault')
            ui.setVaultTab('lorebooks')
            onClose()
          }}
        />
      {:else if wizard.currentStep === 7}
        <Step6Portraits
          protagonist={wizard.character.protagonist}
          supportingCharacters={wizard.character.supportingCharacters}
          {imageGenerationEnabled}
          protagonistVisualDescriptors={wizard.image.protagonistVisualDescriptors}
          protagonistPortrait={wizard.image.protagonistPortrait}
          isGeneratingProtagonistPortrait={wizard.image.isGeneratingProtagonistPortrait}
          isUploadingProtagonistPortrait={wizard.image.isUploadingProtagonistPortrait}
          supportingCharacterVisualDescriptors={wizard.image.supportingCharacterVisualDescriptors}
          supportingCharacterPortraits={wizard.image.supportingCharacterPortraits}
          generatingPortraitName={wizard.image.generatingPortraitName}
          uploadingCharacterName={wizard.image.uploadingCharacterName}
          portraitError={wizard.image.portraitError}
          onProtagonistDescriptorsChange={(v) => (wizard.image.protagonistVisualDescriptors = v)}
          onGenerateProtagonistPortrait={() =>
            wizard.image.generateProtagonistPortrait(wizard.character.protagonist)}
          onRemoveProtagonistPortrait={() => wizard.image.removeProtagonistPortrait()}
          onProtagonistPortraitUpload={(e) => wizard.image.handleProtagonistPortraitUpload(e)}
          onSupportingDescriptorsChange={(name, v) => {
            wizard.image.supportingCharacterVisualDescriptors[name] = v
            // Force reactivity if needed, but rune should handle it if object mutation is detected or reassigned
            wizard.image.supportingCharacterVisualDescriptors = {
              ...wizard.image.supportingCharacterVisualDescriptors,
            }
          }}
          onGenerateSupportingPortrait={(name) =>
            wizard.image.generateSupportingCharacterPortrait(
              name,
              wizard.character.supportingCharacters,
            )}
          onRemoveSupportingPortrait={(name) =>
            wizard.image.removeSupportingCharacterPortrait(name)}
          onSupportingPortraitUpload={(e, name) =>
            wizard.image.handleSupportingCharacterPortraitUpload(e, name)}
        />
      {:else if wizard.currentStep === 8}
        <Step7WritingStyle
          selectedPOV={wizard.narrative.selectedPOV}
          selectedTense={wizard.narrative.selectedTense}
          tone={wizard.narrative.tone}
          visualProseMode={wizard.narrative.visualProseMode}
          {imageGenerationEnabled}
          onPOVChange={(v) => (wizard.narrative.selectedPOV = v)}
          onTenseChange={(v) => (wizard.narrative.selectedTense = v)}
          onToneChange={(v) => (wizard.narrative.tone = v)}
          onVisualProseModeChange={(v) => (wizard.narrative.visualProseMode = v)}
          imageGenerationMode={wizard.narrative.imageGenerationMode}
          onImageGenerationModeChange={(v) => (wizard.narrative.imageGenerationMode = v)}
          backgroundImagesEnabled={wizard.narrative.backgroundImagesEnabled}
          referenceMode={wizard.narrative.referenceMode}
          onBackgroundImagesEnabledChange={(v) => (wizard.narrative.backgroundImagesEnabled = v)}
          onReferenceModeChange={(v) => (wizard.narrative.referenceMode = v)}
        />
      {:else if wizard.currentStep === 9}
        <Step8Opening
          storyTitle={wizard.narrative.storyTitle}
          openingGuidance={wizard.narrative.openingGuidance}
          generatedOpening={wizard.narrative.generatedOpeningDisplay}
          isGeneratingOpening={wizard.narrative.isGeneratingOpening}
          isRefiningOpening={wizard.narrative.isRefiningOpening}
          isEditingOpening={wizard.narrative.isEditingOpening}
          openingDraft={wizard.narrative.openingDraft}
          openingError={wizard.narrative.openingError}
          manualOpeningText={wizard.narrative.manualOpeningText}
          cardImportedFirstMessage={wizard.character.cardImportedFirstMessage}
          cardImportedAlternateGreetings={wizard.character.cardImportedAlternateGreetings}
          selectedGreetingIndex={wizard.character.selectedGreetingIndex}
          selectedMode={wizard.narrative.selectedMode}
          selectedGenre={wizard.narrative.selectedGenre}
          customGenre={wizard.narrative.customGenre}
          selectedPOV={wizard.narrative.selectedPOV}
          selectedTense={wizard.narrative.selectedTense}
          expandedSetting={wizard.setting.expandedSettingDisplay}
          protagonist={wizard.character.protagonistDisplay}
          importedEntriesCount={wizard.narrative.importedEntries.length}
          onTitleChange={(v) => (wizard.narrative.storyTitle = v)}
          onGuidanceChange={(v) => (wizard.narrative.openingGuidance = v)}
          onSelectedGreetingChange={(v) => (wizard.character.selectedGreetingIndex = v)}
          onGenerateOpening={() => wizard.generateOpeningScene()}
          onRefineOpening={() => wizard.refineOpeningScene()}
          onStartEdit={() => wizard.narrative.startOpeningEdit()}
          onCancelEdit={() => wizard.narrative.cancelOpeningEdit()}
          onSaveEdit={() => wizard.narrative.saveOpeningEdit()}
          onDraftChange={(v) => (wizard.narrative.openingDraft = v)}
          onUseCardOpening={() => wizard.narrative.useCardOpening()}
          onClearCardOpening={() => {
            wizard.clearScenarioLinkedLorebook()
            wizard.character.clearCardImport()
          }}
          onManualOpeningChange={(v) => (wizard.narrative.manualOpeningText = v)}
          onClearGenerated={() => wizard.narrative.clearGeneratedOpening()}
        />
      {/if}
    </div>

    <!-- Footer Navigation -->
    <div class="flex shrink-0 justify-between border-t p-4">
      {#if wizard.currentStep > 1}
        <Button variant="secondary" class="gap-1 pl-2" onclick={() => wizard.prevStep()}>
          <ChevronLeft class="h-4 w-4" />
          Back
        </Button>
      {:else}
        <div></div>
      {/if}

      {#if wizard.currentStep === wizard.totalSteps}
        <Button
          variant="default"
          class="flex items-center gap-2"
          onclick={() => wizard.createStory()}
          disabled={!wizard.narrative.storyTitle.trim() ||
            wizard.narrative.isGeneratingOpening ||
            wizard.narrative.isRefiningOpening ||
            wizard.narrative.isEditingOpening ||
            (!wizard.narrative.generatedOpening &&
              !wizard.narrative.manualOpeningText.trim() &&
              !wizard.character.cardImportedFirstMessage)}
        >
          <Play class="h-4 w-4" />
          Begin Story
        </Button>
      {:else}
        <Button
          variant="default"
          class="gap-1 pr-2.5"
          onclick={() => wizard.nextStep()}
          disabled={!wizard.canProceed()}
        >
          Next
          <ChevronRight class="h-4 w-4" />
        </Button>
      {/if}
    </div>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
