<script lang="ts">
  import * as RadioGroup from '$lib/components/ui/radio-group'
  import { Button } from '$lib/components/ui/button'
  import { Label } from '$lib/components/ui/label'
  import { Input } from '$lib/components/ui/input'
  import { Switch } from '$lib/components/ui/switch'
  import { BookOpen, User, Eye } from 'lucide-svelte'
  import type { POV, Tense } from '$lib/types'

  interface Props {
    selectedPOV: POV
    selectedTense: Tense
    tone: string
    visualProseMode: boolean
    imageGenerationEnabled: boolean
    imageGenerationMode: 'none' | 'agentic' | 'inline'
    backgroundImagesEnabled: boolean
    referenceMode: boolean
    onPOVChange: (v: POV) => void
    onTenseChange: (v: Tense) => void
    onToneChange: (v: string) => void
    onVisualProseModeChange: (v: boolean) => void
    onImageGenerationModeChange: (v: 'none' | 'agentic' | 'inline') => void
    onBackgroundImagesEnabledChange: (v: boolean) => void
    onReferenceModeChange: (v: boolean) => void
    disabledFields?: {
      pov?: boolean
      tense?: boolean
      visualProseMode?: boolean
    }
    disabledReason?: string
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
    onPOVChange,
    onTenseChange,
    onToneChange,
    onVisualProseModeChange,
    onImageGenerationModeChange,
    onBackgroundImagesEnabledChange,
    onReferenceModeChange,
    disabledFields,
    disabledReason,
  }: Props = $props()
</script>

<div class="space-y-4">
  <!-- Narrative Config -->
  <section class="grid gap-4 sm:gap-8 md:grid-cols-2">
    <!-- Perspective -->
    <div
      class="space-y-1"
      class:opacity-50={disabledFields?.pov}
      class:pointer-events-none={disabledFields?.pov}
    >
      <Label class="flex items-center gap-2 text-base font-semibold">
        <User class="h-4 w-4" />
        Perspective
      </Label>
      <RadioGroup.Root
        value={selectedPOV}
        onValueChange={(v) => onPOVChange(v as POV)}
        class="grid grid-cols-3 gap-2"
        disabled={disabledFields?.pov}
      >
        {#each ['first', 'second', 'third'] as pov (pov)}
          <Label
            for={`pov-${pov}`}
            class="border-muted bg-popover hover:bg-accent hover:text-accent-foreground has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 flex cursor-pointer flex-col items-center justify-center rounded-md border-2 p-3 text-center"
          >
            <RadioGroup.Item
              value={pov}
              id={`pov-${pov}`}
              class="sr-only"
              disabled={disabledFields?.pov}
            />
            <span class="font-medium capitalize">{pov}</span>
          </Label>
        {/each}
      </RadioGroup.Root>
      <p class="text-muted-foreground h-4 text-xs">
        {#if selectedPOV === 'first'}
          "I draw my sword..."
        {:else if selectedPOV === 'second'}
          "You draw your sword..."
        {:else}
          "He/She/They draw their sword..."
        {/if}
      </p>
      {#if disabledFields?.pov && disabledReason}
        <p class="text-muted-foreground/70 text-xs italic">{disabledReason}</p>
      {/if}
    </div>

    <!-- Tense -->
    <div
      class="space-y-1"
      class:opacity-50={disabledFields?.tense}
      class:pointer-events-none={disabledFields?.tense}
    >
      <Label class="flex items-center gap-2 text-base font-semibold">
        <BookOpen class="h-4 w-4" />
        Tense
      </Label>
      <RadioGroup.Root
        value={selectedTense}
        onValueChange={(v) => onTenseChange(v as Tense)}
        class="grid grid-cols-2 gap-2"
        disabled={disabledFields?.tense}
      >
        {#each ['present', 'past'] as tense (tense)}
          <Label
            for={`tense-${tense}`}
            class="border-muted bg-popover hover:bg-accent hover:text-accent-foreground has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 flex cursor-pointer flex-col items-center justify-center rounded-md border-2 p-3 text-center"
          >
            <RadioGroup.Item
              value={tense}
              id={`tense-${tense}`}
              class="sr-only"
              disabled={disabledFields?.tense}
            />
            <span class="font-medium capitalize">{tense}</span>
          </Label>
        {/each}
      </RadioGroup.Root>
      <p class="text-muted-foreground h-4 text-xs">
        {#if selectedTense === 'present'}
          Action happens now.
        {:else}
          Action happened in the past.
        {/if}
      </p>
      {#if disabledFields?.tense && disabledReason}
        <p class="text-muted-foreground/70 text-xs italic">{disabledReason}</p>
      {/if}
    </div>
  </section>

  <!-- Tone -->
  <section class="space-y-2 pt-1">
    <div class="grid w-full items-center gap-2">
      <Input
        label="Narrative Tone"
        id="tone"
        value={tone}
        oninput={(e) => onToneChange(e.currentTarget.value)}
        placeholder="e.g. Dark and gritty, Whimsical, Clinical"
      />
    </div>
    <div class="flex flex-wrap gap-2">
      {#each ['Dark Fantasy', 'High Adventure', 'Cozy', 'Horror', 'Cyberpunk', 'Mystery'] as t (t)}
        <Button variant="outline" size="sm" class="h-7 text-xs" onclick={() => onToneChange(t)}>
          {t}
        </Button>
      {/each}
    </div>
  </section>

  <!-- Visuals Configuration -->
  {#if imageGenerationEnabled}
    <section class="space-y-2 pt-1">
      <Label class="flex items-center gap-2 text-base font-semibold">
        <Eye class="h-4 w-4" />
        Visual Experience
      </Label>

      <RadioGroup.Root
        value={imageGenerationMode}
        onValueChange={(v) => onImageGenerationModeChange(v as 'none' | 'agentic' | 'inline')}
        class="grid grid-cols-1 gap-4 md:grid-cols-3"
      >
        <!-- No Images -->
        <div class="relative">
          <Label
            for="img-none"
            class="border-muted bg-popover hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 flex h-full cursor-pointer flex-col justify-between rounded-xl border-2 p-4"
          >
            <div class="mb-2 flex w-full items-start justify-between">
              <span class="font-semibold">Text Only</span>
              <RadioGroup.Item value="none" id="img-none" class="sr-only" />
            </div>
            <div class="text-muted-foreground text-xs font-normal">
              Pure text adventure. No images will be generated.
            </div>
          </Label>
        </div>

        <!-- Agent Mode -->
        <div class="relative">
          <Label
            for="img-auto"
            class="border-muted bg-popover hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 flex h-full cursor-pointer flex-col justify-between rounded-xl border-2 p-4"
          >
            <div class="mb-2 flex w-full items-start justify-between">
              <span class="font-semibold">Agent Mode</span>
              <RadioGroup.Item value="agentic" id="img-auto" class="sr-only" />
            </div>
            <div class="text-muted-foreground text-xs font-normal">
              AI decides when to generate images based on the story.
            </div>
          </Label>
        </div>

        <!-- Inline Mode -->
        <div class="relative">
          <Label
            for="img-inline"
            class="border-muted bg-popover hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 flex h-full cursor-pointer flex-col justify-between rounded-xl border-2 p-4"
          >
            <div class="mb-2 flex w-full items-start justify-between">
              <span class="font-semibold">Inline Mode</span>
              <RadioGroup.Item value="inline" id="img-inline" class="sr-only" />
            </div>
            <div class="text-muted-foreground text-xs font-normal">
              Images are embedded directly in the text flow.
            </div>
          </Label>
        </div>
      </RadioGroup.Root>

      <!-- Extra Image Toggles -->
      <div class="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
        <div class="flex items-center space-x-2">
          <Switch
            id="bg-images"
            checked={backgroundImagesEnabled}
            onCheckedChange={onBackgroundImagesEnabledChange}
          />
          <div class="grid gap-1.5 leading-none">
            <Label for="bg-images">Background Images</Label>
            <p class="text-muted-foreground text-xs">
              Generate immersive background images for scenes.
            </p>
          </div>
        </div>

        <div class="flex items-center space-x-2">
          <Switch
            id="reference-mode"
            checked={referenceMode}
            onCheckedChange={onReferenceModeChange}
          />
          <div class="grid gap-1.5 leading-none">
            <Label for="reference-mode">Portrait Reference Mode</Label>
            <p class="text-muted-foreground text-xs">
              Use character portraits as visual references.
            </p>
          </div>
        </div>
      </div>
    </section>
  {/if}

  <!-- Visual Prose Styling -->
  <section class="space-y-2 pt-1">
    <div
      class="flex items-center space-x-2 py-4"
      class:opacity-50={disabledFields?.visualProseMode}
      class:pointer-events-none={disabledFields?.visualProseMode}
    >
      <Switch
        id="visual-prose"
        checked={visualProseMode}
        onCheckedChange={onVisualProseModeChange}
        disabled={disabledFields?.visualProseMode}
      />
      <div class="grid gap-1.5 leading-none">
        <Label for="visual-prose">Visual Prose Styling</Label>
        <p class="text-muted-foreground text-xs">
          Enable rich text formatting (colors, fonts) for dialogue and actions.
        </p>
        {#if disabledFields?.visualProseMode && disabledReason}
          <p class="text-muted-foreground/70 text-xs italic">{disabledReason}</p>
        {/if}
      </div>
    </div>
  </section>
</div>
