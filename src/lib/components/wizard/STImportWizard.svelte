<script lang="ts">
  import { onDestroy } from 'svelte'
  import { STImportWizardStore } from '$lib/stores/wizard/stImportWizard.svelte'
  import { story } from '$lib/stores/story.svelte'
  import { hasRequiredCredentials } from '$lib/services/ai/image'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { releaseOrphanScrollLock, blurFocusedElement } from '$lib/utils/scrollLock'
  import { MODAL_CLOSE_TRANSITION_MS } from '$lib/constants/layout'
  import { createIsMobile } from '$lib/hooks/is-mobile.svelte'
  import { Button } from '$lib/components/ui/button'
  import { ChevronLeft, ChevronRight, Play, X } from '@lucide/svelte'

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
  import WizardExitConfirm from './WizardExitConfirm.svelte'

  interface Props {
    onClose: () => void
  }

  let { onClose }: Props = $props()

  const isMobile = createIsMobile()

  let isOpen = $state(true)
  let showExitConfirm = $state(false)

  /**
   * A close driven from this side never reaches `vaul`'s restore, and `onClose()` unmounts
   * the component, so the teardown is done by hand. See `$lib/utils/scrollLock`.
   */
  function handleClose() {
    blurFocusedElement(isMobile.current)
    isOpen = false
    setTimeout(() => {
      releaseOrphanScrollLock()
      onClose()
    }, MODAL_CLOSE_TRANSITION_MS)
  }

  onDestroy(() => releaseOrphanScrollLock())

  const wizard = new STImportWizardStore(() => handleClose())

  /**
   * Past the first step the wizard holds uploads and choices that exist nowhere else, so a
   * stray tap on the backdrop has to be confirmed instead of silently discarding them.
   */
  const guardDismiss = $derived(wizard.currentStep > 1 && !wizard.isCreatingStory)

  /**
   * A drawer swipe has no event to intercept, so it is switched off rather than confirmed;
   * the header's close button is the deliberate way out on mobile.
   */
  const allowSwipeDismiss = $derived(!guardDismiss && !wizard.isCreatingStory)

  function requestDismiss() {
    if (guardDismiss) showExitConfirm = true
    else handleClose()
  }

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

<ResponsiveModal.Root
  open={isOpen}
  dismissible={allowSwipeDismiss}
  onOpenChange={(open) => !open && !wizard.isCreatingStory && handleClose()}
>
  <ResponsiveModal.Content
    class="flex h-full flex-col gap-0 p-0 sm:h-auto sm:max-h-[90vh] sm:max-w-3xl"
    interactOutsideBehavior={wizard.isCreatingStory ? 'ignore' : 'close'}
    escapeKeydownBehavior={wizard.isCreatingStory ? 'ignore' : 'close'}
    onInteractOutside={(e: PointerEvent) => {
      e.preventDefault()
      requestDismiss()
    }}
    onEscapeKeydown={(e: KeyboardEvent) => {
      e.preventDefault()
      if (showExitConfirm) showExitConfirm = false
      else requestDismiss()
    }}
  >
    <!-- Header -->
    <div class="flex flex-col border-b p-4 pb-4" inert={showExitConfirm}>
      <div class="mb-4 flex items-center justify-between gap-2">
        <div class="min-w-0">
          <ResponsiveModal.Title class="text-xl">Import from SillyTavern</ResponsiveModal.Title>
          <ResponsiveModal.Description>
            Step {wizard.currentStep} of {wizard.totalSteps}: {stepTitles[wizard.currentStep - 1]}
          </ResponsiveModal.Description>
        </div>
        <Button
          variant="ghost"
          class="text-muted-foreground hover:text-foreground h-9 w-9 shrink-0 p-0"
          title="Close wizard"
          disabled={wizard.isCreatingStory}
          onclick={requestDismiss}
        >
          <X class="h-5 w-5" />
        </Button>
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
    <div class="min-h-0 flex-1 overflow-y-auto p-4" inert={showExitConfirm}>
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
          chapterizeAfterImport={wizard.chapterizeAfterImport}
          chapterizeIncludeLorebook={wizard.chapterizeIncludeLorebook}
          chapterizeIncludeTimeline={wizard.chapterizeIncludeTimeline}
          chapterizeIncludeClassification={wizard.chapterizeIncludeClassification}
          chapterizationProgress={story.chapterizationProgress}
          chapterizationTimelineProgress={story.chapterizationTimelineProgress}
          chapterizationClassificationProgress={story.chapterizationClassificationProgress}
          chapterizationStatus={story.chapterizationStatus}
          onTitleChange={(v) => (wizard.storyTitle = v)}
          onSaveToVaultChange={(v) => (wizard.saveToVault = v)}
          onVaultTagChange={(v) => (wizard.vaultTag = v)}
          onVaultDescriptionChange={(v) => (wizard.vaultDescription = v)}
          onChapterizeAfterImportChange={(v) => (wizard.chapterizeAfterImport = v)}
          onChapterizeIncludeLorebookChange={(v) => (wizard.chapterizeIncludeLorebook = v)}
          onChapterizeIncludeTimelineChange={(v) => (wizard.chapterizeIncludeTimeline = v)}
          onChapterizeIncludeClassificationChange={(v) =>
            (wizard.chapterizeIncludeClassification = v)}
          onCancelChapterization={() => story.requestChapterizationCancel()}
        />
      {/if}
    </div>

    <!-- Footer Navigation -->
    <div class="flex shrink-0 justify-between border-t p-4" inert={showExitConfirm}>
      {#if wizard.currentStep > 1}
        <Button
          variant="secondary"
          class="gap-1 pl-2"
          onclick={() => wizard.prevStep()}
          disabled={wizard.isCreatingStory}
        >
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

    <WizardExitConfirm
      open={showExitConfirm}
      title="Discard this import?"
      onCancel={() => (showExitConfirm = false)}
      onDiscard={() => {
        showExitConfirm = false
        handleClose()
      }}
    />
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
