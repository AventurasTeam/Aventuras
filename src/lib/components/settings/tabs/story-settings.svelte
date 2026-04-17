<script lang="ts">
  import { story } from '$lib/stores/story/index.svelte'
  import { hasRequiredCredentials } from '$lib/services/ai/image'
  import WritingStyleFields from '$lib/components/shared/WritingStyleFields.svelte'

  const imageGenEnabled = $derived(hasRequiredCredentials())
</script>

<div class="space-y-6">
  <div>
    <h3 class="text-lg font-semibold">Story Settings</h3>
    <p class="text-muted-foreground text-sm">Configure settings for the current story.</p>
  </div>

  <WritingStyleFields
    selectedPOV={story.settings.pov}
    selectedTense={story.settings.tense}
    tone={story.settings.tone ?? ''}
    visualProseMode={story.settings.visualProseMode ?? false}
    imageGenerationEnabled={imageGenEnabled}
    imageGenerationMode={story.settings.imageGenerationMode ?? 'none'}
    backgroundImagesEnabled={story.settings.backgroundImagesEnabled ?? false}
    referenceMode={story.settings.referenceMode ?? false}
    onPOVChange={(v) => story.settings.updateSettings({ pov: v })}
    onTenseChange={(v) => story.settings.updateSettings({ tense: v })}
    onToneChange={(v) => story.settings.updateSettings({ tone: v })}
    onVisualProseModeChange={(v) => story.settings.updateSettings({ visualProseMode: v })}
    onImageGenerationModeChange={(v) => story.settings.updateSettings({ imageGenerationMode: v })}
    onBackgroundImagesEnabledChange={(v) =>
      story.settings.updateSettings({ backgroundImagesEnabled: v })}
    onReferenceModeChange={(v) => story.settings.updateSettings({ referenceMode: v })}
    disabledFields={{ pov: true, tense: true, visualProseMode: true }}
    disabledReason="Cannot be changed mid-story. Set during story creation."
  />
</div>
