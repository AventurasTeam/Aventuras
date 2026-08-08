<script lang="ts">
  import WritingStyleFields from '$lib/components/shared/WritingStyleFields.svelte'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import type { POV, Tense, TargetLength } from '$lib/types'

  interface Props {
    selectedPOV: POV
    selectedTense: Tense
    tone: string
    visualProseMode: boolean
    imageGenerationEnabled: boolean
    imageGenerationMode: 'none' | 'agentic' | 'inline'
    backgroundImagesEnabled: boolean
    referenceMode: boolean
    targetLength?: TargetLength
    mode?: 'adventure' | 'creative-writing'
    onPOVChange: (v: POV) => void
    onTenseChange: (v: Tense) => void
    onToneChange: (v: string) => void
    onVisualProseModeChange: (v: boolean) => void
    onImageGenerationModeChange: (v: 'none' | 'agentic' | 'inline') => void
    onBackgroundImagesEnabledChange: (v: boolean) => void
    onReferenceModeChange: (v: boolean) => void
    onTargetLengthChange?: (v: TargetLength) => void
  }

  let {
    selectedPOV,
    selectedTense,
    tone,
    visualProseMode,
    imageGenerationEnabled,
    imageGenerationMode,
    backgroundImagesEnabled,
    referenceMode,
    targetLength = 'dynamic',
    mode = 'adventure',
    onPOVChange,
    onTenseChange,
    onToneChange,
    onVisualProseModeChange,
    onImageGenerationModeChange,
    onBackgroundImagesEnabledChange,
    onReferenceModeChange,
    onTargetLengthChange,
  }: Props = $props()

  // Force "none" mode when image generation is disabled (wizard only)
  $effect(() => {
    if (!imageGenerationEnabled && imageGenerationMode !== 'none') {
      onImageGenerationModeChange('none')
    }
  })
</script>

<div class="flex h-full flex-col gap-4 p-1">
  <div class="flex items-center justify-between">
    <div>
      <h3 class="text-lg font-bold tracking-tight">Writing Style</h3>
      <p class="text-muted-foreground">
        Choose a narrative voice and configure the AI's writing style.
      </p>
    </div>
  </div>

  <ScrollArea class="h-full pr-4">
    <WritingStyleFields
      {selectedPOV}
      {selectedTense}
      {tone}
      {visualProseMode}
      {imageGenerationEnabled}
      {imageGenerationMode}
      {backgroundImagesEnabled}
      {referenceMode}
      {targetLength}
      {mode}
      {onPOVChange}
      {onTenseChange}
      {onToneChange}
      {onVisualProseModeChange}
      {onImageGenerationModeChange}
      {onBackgroundImagesEnabledChange}
      {onReferenceModeChange}
      {onTargetLengthChange}
    />
  </ScrollArea>
</div>
