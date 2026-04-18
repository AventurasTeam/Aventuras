<script lang="ts">
  import { Sword, Feather, MessageSquare, FileText } from 'lucide-svelte'
  import * as Card from '$lib/components/ui/card'
  import { Label } from '$lib/components/ui/label'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import WritingStyleFields from '$lib/components/shared/WritingStyleFields.svelte'
  import { hasRequiredCredentials } from '$lib/services/ai/image'
  import type { StoryMode, POV } from '$lib/types'
  import type { Tense } from '$lib/services/ai/wizard/ScenarioService'

  interface Props {
    selectedMode: StoryMode
    selectedPOV: POV
    selectedTense: Tense
    tone: string
    visualProseMode: boolean
    imageGenerationMode: 'none' | 'agentic' | 'inline'
    backgroundImagesEnabled: boolean
    referenceMode: boolean
    importChatAsEntries: boolean
    hasChatFile: boolean
    hasCardOpening: boolean
    chatMessageCount: number
    onModeChange: (mode: StoryMode) => void
    onPOVChange: (v: POV) => void
    onTenseChange: (v: Tense) => void
    onToneChange: (v: string) => void
    onVisualProseModeChange: (v: boolean) => void
    onImageGenerationModeChange: (v: 'none' | 'agentic' | 'inline') => void
    onBackgroundImagesEnabledChange: (v: boolean) => void
    onReferenceModeChange: (v: boolean) => void
    onImportChatToggle: (v: boolean) => void
  }

  let {
    selectedMode,
    selectedPOV,
    selectedTense,
    tone,
    visualProseMode,
    imageGenerationMode,
    backgroundImagesEnabled,
    referenceMode,
    importChatAsEntries,
    hasChatFile,
    hasCardOpening,
    chatMessageCount,
    onModeChange,
    onPOVChange,
    onTenseChange,
    onToneChange,
    onVisualProseModeChange,
    onImageGenerationModeChange,
    onBackgroundImagesEnabledChange,
    onReferenceModeChange,
    onImportChatToggle,
  }: Props = $props()

  const imageGenerationEnabled = $derived(hasRequiredCredentials())

  // Keep imported wizard behavior consistent with setup wizard when image generation is unavailable.
  $effect(() => {
    if (!imageGenerationEnabled && imageGenerationMode !== 'none') {
      onImageGenerationModeChange('none')
    }
  })
</script>

<div class="flex h-full flex-col gap-5">
  <!-- Story Mode -->
  <div class="space-y-2">
    <Label>Story Mode</Label>
    <div class="grid grid-cols-2 gap-3">
      <button class="w-full text-left focus:outline-none" onclick={() => onModeChange('adventure')}>
        <Card.Root
          class="h-full transition-all {selectedMode === 'adventure'
            ? 'ring-primary border-primary ring-2'
            : 'border-border hover:border-primary/40'}"
        >
          <Card.Content class="flex items-center gap-3 p-3">
            <Sword
              class="h-5 w-5 {selectedMode === 'adventure'
                ? 'text-primary'
                : 'text-muted-foreground'}"
            />
            <div>
              <p class="text-sm font-medium">Adventure</p>
              <p class="text-muted-foreground text-xs">You are the protagonist</p>
            </div>
          </Card.Content>
        </Card.Root>
      </button>
      <button
        class="w-full text-left focus:outline-none"
        onclick={() => onModeChange('creative-writing')}
      >
        <Card.Root
          class="h-full transition-all {selectedMode === 'creative-writing'
            ? 'ring-primary border-primary ring-2'
            : 'border-border hover:border-primary/40'}"
        >
          <Card.Content class="flex items-center gap-3 p-3">
            <Feather
              class="h-5 w-5 {selectedMode === 'creative-writing'
                ? 'text-primary'
                : 'text-muted-foreground'}"
            />
            <div>
              <p class="text-sm font-medium">Creative Writing</p>
              <p class="text-muted-foreground text-xs">You are the author</p>
            </div>
          </Card.Content>
        </Card.Root>
      </button>
    </div>
  </div>

  <!-- Chat Import Mode -->
  <div class="space-y-2">
    <Label>Chat History</Label>
    <div class="grid grid-cols-2 gap-3">
      <button
        class="w-full text-left focus:outline-none"
        onclick={() => onImportChatToggle(true)}
        disabled={!hasChatFile}
      >
        <Card.Root
          class="h-full transition-all {importChatAsEntries
            ? 'ring-primary border-primary ring-2'
            : 'border-border hover:border-primary/40'} {!hasChatFile
            ? 'cursor-not-allowed opacity-50'
            : ''}"
        >
          <Card.Content class="flex items-center gap-3 p-3">
            <MessageSquare
              class="h-5 w-5 {importChatAsEntries ? 'text-primary' : 'text-muted-foreground'}"
            />
            <div>
              <p class="text-sm font-medium">Import Chat</p>
              <p class="text-muted-foreground text-xs">
                {#if hasChatFile}
                  {chatMessageCount} messages as story entries
                {:else}
                  No chat file uploaded
                {/if}
              </p>
            </div>
          </Card.Content>
        </Card.Root>
      </button>
      <button
        class="w-full text-left focus:outline-none"
        onclick={() => onImportChatToggle(false)}
        disabled={!hasCardOpening}
      >
        <Card.Root
          class="h-full transition-all {!importChatAsEntries
            ? 'ring-primary border-primary ring-2'
            : 'border-border hover:border-primary/40'} {!hasCardOpening ? 'opacity-50' : ''}"
        >
          <Card.Content class="flex items-center gap-3 p-3">
            <FileText
              class="h-5 w-5 {!importChatAsEntries ? 'text-primary' : 'text-muted-foreground'}"
            />
            <div>
              <p class="text-sm font-medium">Fresh Start</p>
              <p class="text-muted-foreground text-xs">
                {#if hasCardOpening}
                  Use card's opening message
                {:else}
                  Requires character card with greeting
                {/if}
              </p>
            </div>
          </Card.Content>
        </Card.Root>
      </button>
    </div>
  </div>

  <!-- Writing Style -->
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
      {onPOVChange}
      {onTenseChange}
      {onToneChange}
      {onVisualProseModeChange}
      {onImageGenerationModeChange}
      {onBackgroundImagesEnabledChange}
      {onReferenceModeChange}
    />
  </ScrollArea>
</div>
