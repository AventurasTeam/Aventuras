<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { hasRequiredCredentials } from '$lib/services/ai/image'
  import WritingStyleFields from '$lib/components/shared/WritingStyleFields.svelte'

  const storySettings = $derived(story.currentStory?.settings ?? {})
  const imageGenEnabled = $derived(hasRequiredCredentials())
</script>

<div class="space-y-6">
  <div>
    <h3 class="text-lg font-semibold">Story Settings</h3>
    <p class="text-muted-foreground text-sm">Configure settings for the current story.</p>
  </div>

  <WritingStyleFields
    selectedPOV={storySettings.pov ?? 'second'}
    selectedTense={storySettings.tense ?? 'present'}
    tone={storySettings.tone ?? ''}
    visualProseMode={storySettings.visualProseMode ?? false}
    imageGenerationEnabled={imageGenEnabled}
    imageGenerationMode={storySettings.imageGenerationMode ?? 'none'}
    backgroundImagesEnabled={storySettings.backgroundImagesEnabled ?? false}
    referenceMode={storySettings.referenceMode ?? false}
    onPOVChange={(v) => story.updateStorySettings({ pov: v })}
    onTenseChange={(v) => story.updateStorySettings({ tense: v })}
    onToneChange={(v) => story.updateStorySettings({ tone: v })}
    onVisualProseModeChange={(v) => story.updateStorySettings({ visualProseMode: v })}
    onImageGenerationModeChange={(v) => story.updateStorySettings({ imageGenerationMode: v })}
    onBackgroundImagesEnabledChange={(v) =>
      story.updateStorySettings({ backgroundImagesEnabled: v })}
    onReferenceModeChange={(v) => story.updateStorySettings({ referenceMode: v })}
    disabledFields={{ pov: true, tense: true, visualProseMode: true }}
    disabledReason="Cannot be changed mid-story. Set during story creation."
  />
</div>
