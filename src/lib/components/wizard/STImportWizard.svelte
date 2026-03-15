<script lang="ts">
  import { STImportWizardStore } from '$lib/stores/wizard/stImportWizard.svelte'
  import { hasRequiredCredentials } from '$lib/services/ai/image'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { ChevronLeft, ChevronRight, Play } from 'lucide-svelte'

  import {
    StepUploadFiles,
    StepImportSelection,
    StepImportCharacters,
    StepImportWorld,
    StepImportStyle,
    StepImportReview,
  } from './st-import-steps'
  import Step6Portraits from './steps/Step6Portraits.svelte'
  import StepPackSelection from './steps/StepPackSelection.svelte'

  interface Props {
    onClose: () => void
  }

  let { onClose }: Props = $props()

  const wizard = new STImportWizardStore(() => onClose())

  const imageGenerationEnabled = $derived(hasRequiredCredentials())

  const stepTitles = [
    'Prompt Pack',
    'Upload Files',
    'Import Selection',
    'Characters',
    'World & Lorebook',
    'Style & Chat Options',
    'Character Portraits (Optional)',
    'Review & Create',
  ]
</script>

<ResponsiveModal.Root open={true} onOpenChange={(open) => !open && onClose()}>
  <ResponsiveModal.Content
    class="flex h-full flex-col gap-0 p-0 sm:h-auto sm:max-h-[90vh] sm:max-w-3xl"
  >
    <!-- Header -->
    <div class="flex flex-col border-b p-4 pb-4">
      <div class="mb-4 flex items-center justify-between">
        <div>
          <ResponsiveModal.Title class="text-xl">Import from SillyTavern</ResponsiveModal.Title>
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
              : i < wizard.currentStep - 1
                ? 'bg-primary/40'
                : 'bg-muted'}"
          ></div>
        {/each}
      </div>
    </div>

    <!-- Content -->
    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      {#if wizard.currentStep === 1}
        <StepPackSelection
          availablePacks={wizard.availablePacks}
          selectedPackId={wizard.selectedPackId}
          packVariables={wizard.packVariables}
          variableValues={wizard.customVariableValues}
          onSelectPack={(packId) => wizard.selectPack(packId)}
          onVariableChange={(name, value) => wizard.setVariableValue(name, value)}
        />
      {:else if wizard.currentStep === 2}
        <StepUploadFiles
          chatParseResult={wizard.chatParseResult}
          chatFileError={wizard.chatFileError}
          cardParsedData={wizard.cardParsedData}
          cardPortrait={wizard.cardPortrait}
          cardFileError={wizard.cardFileError}
          onChatFileProcess={(text: string) => wizard.processChatFile(text)}
          onChatFileClear={() => wizard.clearChatFile()}
          onCardFileProcess={(file: File) => wizard.processCardFile(file)}
          onCardFileClear={() => wizard.clearCardFile()}
        />
      {:else if wizard.currentStep === 3}
        <StepImportSelection
          cardParsedData={wizard.cardParsedData}
          cardPortrait={wizard.cardPortrait}
          sanitizedDescription={wizard.cardSanitized?.description ?? null}
          hasEmbeddedLorebook={wizard.hasEmbeddedLorebook}
          embeddedLorebookEntryCount={wizard.embeddedLorebookData?.entries.length ?? 0}
          importCharacters={wizard.importCharacters}
          importScenario={wizard.importScenario}
          importLorebook={wizard.importLorebook}
          isProcessingCard={wizard.isProcessingCard}
          cardImportResult={wizard.cardImportResult}
          cardProcessError={wizard.cardProcessError}
          onImportCharactersChange={(v) => (wizard.importCharacters = v)}
          onImportScenarioChange={(v) => (wizard.importScenario = v)}
          onImportLorebookChange={(v) => (wizard.importLorebook = v)}
          onProcessCard={() => wizard.processCardImport()}
        />
      {:else if wizard.currentStep === 4}
        <StepImportCharacters
          protagonist={wizard.protagonist}
          protagonistPortrait={wizard.protagonistPortrait}
          manualCharacterName={wizard.manualCharacterName}
          manualCharacterDescription={wizard.manualCharacterDescription}
          manualCharacterBackground={wizard.manualCharacterBackground}
          manualCharacterMotivation={wizard.manualCharacterMotivation}
          manualCharacterTraits={wizard.manualCharacterTraits}
          showManualInput={wizard.showManualInput}
          showVaultPicker={wizard.showVaultPicker}
          supportingCharacters={wizard.supportingCharacters}
          cardCharacterName={wizard.cardCharacterName}
          characterPortraits={wizard.characterPortraits}
          onManualNameChange={(v) => (wizard.manualCharacterName = v)}
          onManualDescriptionChange={(v) => (wizard.manualCharacterDescription = v)}
          onManualBackgroundChange={(v) => (wizard.manualCharacterBackground = v)}
          onManualMotivationChange={(v) => (wizard.manualCharacterMotivation = v)}
          onManualTraitsChange={(v) => (wizard.manualCharacterTraits = v)}
          onUseManualCharacter={() => wizard.useManualCharacter()}
          onUpdateProtagonist={(p, portrait) => wizard.updateProtagonist(p, portrait)}
          onSelectFromVault={(c) => wizard.selectProtagonistFromVault(c)}
          onToggleVaultPicker={(v) => (wizard.showVaultPicker = v)}
          onDeleteSupportingCharacter={(i) => wizard.deleteSupportingCharacter(i)}
          onUpdateSupportingCharacter={(i, c) => wizard.updateSupportingCharacter(i, c)}
          onUpdateCharacterPortrait={(name, portrait) =>
            wizard.updateCharacterPortrait(name, portrait)}
        />
      {:else if wizard.currentStep === 5}
        <StepImportWorld
          settingSeed={wizard.settingSeed}
          expandedSetting={wizard.expandedSetting}
          isExpandingSetting={wizard.isExpandingSetting}
          settingError={wizard.settingError}
          importedLorebooks={wizard.importedLorebooks}
          onSettingSeedChange={(v) => (wizard.settingSeed = v)}
          onUseAsIs={() => wizard.useSettingAsIs()}
          onExpandSetting={() => wizard.expandSetting()}
          onSelectLorebookFromVault={(l) => wizard.addLorebookFromVault(l)}
          onRemoveLorebook={(id) => wizard.removeLorebook(id)}
          onToggleLorebookExpanded={(id) => wizard.toggleLorebookExpanded(id)}
        />
      {:else if wizard.currentStep === 6}
        <StepImportStyle
          selectedMode={wizard.selectedMode}
          selectedPOV={wizard.selectedPOV}
          selectedTense={wizard.selectedTense}
          tone={wizard.tone}
          visualProseMode={wizard.visualProseMode}
          imageGenerationMode={wizard.imageGenerationMode}
          backgroundImagesEnabled={wizard.backgroundImagesEnabled}
          referenceMode={wizard.referenceMode}
          importChatAsEntries={wizard.importChatAsEntries}
          hasChatFile={wizard.chatParseResult !== null}
          hasCardOpening={!!wizard.cardImportResult?.firstMessage}
          chatMessageCount={wizard.chatMessages.length}
          onModeChange={(v) => (wizard.selectedMode = v)}
          onPOVChange={(v) => (wizard.selectedPOV = v)}
          onTenseChange={(v) => (wizard.selectedTense = v)}
          onToneChange={(v) => (wizard.tone = v)}
          onVisualProseModeChange={(v) => (wizard.visualProseMode = v)}
          onImageGenerationModeChange={(v) => (wizard.imageGenerationMode = v)}
          onBackgroundImagesEnabledChange={(v) => (wizard.backgroundImagesEnabled = v)}
          onReferenceModeChange={(v) => (wizard.referenceMode = v)}
          onImportChatToggle={(v) => (wizard.importChatAsEntries = v)}
        />
      {:else if wizard.currentStep === 7}
        <Step6Portraits
          protagonist={wizard.protagonist}
          supportingCharacters={wizard.supportingCharacters}
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
            wizard.image.generateProtagonistPortrait(wizard.protagonist)}
          onRemoveProtagonistPortrait={() => wizard.image.removeProtagonistPortrait()}
          onProtagonistPortraitUpload={(e) => wizard.image.handleProtagonistPortraitUpload(e)}
          onSupportingDescriptorsChange={(name, v) =>
            (wizard.image.supportingCharacterVisualDescriptors[name] = v)}
          onGenerateSupportingPortrait={(name) =>
            wizard.image.generateSupportingCharacterPortrait(name, wizard.supportingCharacters)}
          onRemoveSupportingPortrait={(name) =>
            wizard.image.removeSupportingCharacterPortrait(name)}
          onSupportingPortraitUpload={(e, name) =>
            wizard.image.handleSupportingCharacterPortraitUpload(e, name)}
        />
      {:else if wizard.currentStep === 8}
        <StepImportReview
          storyTitle={wizard.storyTitle}
          selectedMode={wizard.selectedMode}
          selectedPOV={wizard.selectedPOV}
          selectedTense={wizard.selectedTense}
          tone={wizard.tone}
          protagonist={wizard.protagonist}
          protagonistPortrait={wizard.protagonistPortrait}
          supportingCharacters={wizard.supportingCharacters}
          settingSeed={wizard.settingSeed}
          importedLorebooks={wizard.importedLorebooks}
          importChatAsEntries={wizard.importChatAsEntries}
          chatMessageCount={wizard.chatMessages.length}
          isCreatingStory={wizard.isCreatingStory}
          createError={wizard.createError}
          saveToVault={wizard.saveToVault}
          hasCard={wizard.hasCard}
          vaultTag={wizard.vaultTag}
          vaultDescription={wizard.vaultDescription}
          onTitleChange={(v) => (wizard.storyTitle = v)}
          onSaveToVaultChange={(v) => (wizard.saveToVault = v)}
          onVaultTagChange={(v) => (wizard.vaultTag = v)}
          onVaultDescriptionChange={(v) => (wizard.vaultDescription = v)}
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
          disabled={!wizard.storyTitle.trim() || wizard.isCreatingStory}
        >
          {#if wizard.isCreatingStory}
            Creating...
          {:else}
            <Play class="h-4 w-4" />
            Create Story
          {/if}
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
