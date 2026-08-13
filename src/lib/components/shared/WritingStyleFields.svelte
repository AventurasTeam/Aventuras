<script lang="ts">
  import * as RadioGroup from '$lib/components/ui/radio-group'
  import { Button } from '$lib/components/ui/button'
  import { Label } from '$lib/components/ui/label'
  import { Input } from '$lib/components/ui/input'
  import { Switch } from '$lib/components/ui/switch'
  import { BookOpen, User, Eye, AlignLeft } from '@lucide/svelte'
  import type { POV, Tense, TargetLength, ImageGenerationMode } from '$lib/types'

  interface Props {
    selectedPOV: POV
    selectedTense: Tense
    tone: string
    visualProseMode: boolean
    /** Standard image slot is usable — gates the image mode choice. */
    imageGenerationEnabled: boolean
    /** Background slot is usable. Defaults to `imageGenerationEnabled`. */
    backgroundImagesAvailable?: boolean
    /** Portrait or reference slot is usable. Defaults to `imageGenerationEnabled`. */
    portraitReferenceAvailable?: boolean
    imageGenerationMode: ImageGenerationMode
    backgroundImagesEnabled: boolean
    referenceMode: boolean
    targetLength?: TargetLength
    /** Drives the paragraph counts shown for each length: they differ per mode. */
    mode?: 'adventure' | 'creative-writing'
    /** Set to disable the length control, e.g. a custom prompt that never renders it. */
    targetLengthDisabledReason?: string
    onPOVChange: (v: POV) => void
    onTenseChange: (v: Tense) => void
    onToneChange: (v: string) => void
    onVisualProseModeChange: (v: boolean) => void
    onImageGenerationModeChange: (v: ImageGenerationMode) => void
    onBackgroundImagesEnabledChange: (v: boolean) => void
    onReferenceModeChange: (v: boolean) => void
    onTargetLengthChange?: (v: TargetLength) => void
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
    backgroundImagesAvailable,
    portraitReferenceAvailable,
    imageGenerationMode,
    backgroundImagesEnabled,
    referenceMode,
    targetLength = 'dynamic',
    mode = 'adventure',
    targetLengthDisabledReason,
    onPOVChange,
    onTenseChange,
    onToneChange,
    onVisualProseModeChange,
    onImageGenerationModeChange,
    onBackgroundImagesEnabledChange,
    onReferenceModeChange,
    onTargetLengthChange,
    disabledFields,
    disabledReason,
  }: Props = $props()

  const IMAGE_MODES: { value: ImageGenerationMode; label: string; description: string }[] = [
    {
      value: 'none',
      label: 'Text Only',
      description: 'Pure text adventure. No images will be generated.',
    },
    {
      value: 'agentic',
      label: 'Agent Mode',
      description: 'AI decides when to generate images based on the story.',
    },
    {
      value: 'inline',
      label: 'Inline Mode',
      description: 'Images are embedded directly in the text flow.',
    },
  ]

  const backgroundAvailable = $derived(backgroundImagesAvailable ?? imageGenerationEnabled)
  const portraitAvailable = $derived(portraitReferenceAvailable ?? imageGenerationEnabled)

  // An unconfigured option can still be turned off, never on: the current selection stays
  // reachable so a story set up on another machine isn't stuck with it.
  function modeLocked(value: ImageGenerationMode): boolean {
    return !imageGenerationEnabled && value !== 'none' && value !== imageGenerationMode
  }
  const imageProfileMissing = $derived(
    !imageGenerationEnabled || !backgroundAvailable || !portraitAvailable,
  )

  /** Must match the ranges `formatLengthInstruction` asks for, which differ per mode. */
  const LENGTH_RANGES = {
    adventure: {
      dynamic: {
        short: 'Auto',
        long: 'Adapts length naturally to scene pacing (1–2 paragraphs for action, up to 5–6 for atmosphere).',
      },
      short: { short: '1-3 para', long: 'Crisp and fast-paced narrative (1–3 paragraphs).' },
      medium: { short: '2-4 para', long: 'Balanced storytelling momentum (2–4 paragraphs).' },
      long: {
        short: '3-6 para',
        long: 'Detailed, expansive prose & environment (3–6 paragraphs).',
      },
    },
    'creative-writing': {
      dynamic: {
        short: 'Auto',
        long: 'Scales with the scene (2–3 paragraphs for rapid exchanges, 4–8 for chapter sections).',
      },
      short: {
        short: '2-4 para',
        long: 'Focused, economical prose with immediate momentum (2–4 paragraphs).',
      },
      medium: {
        short: '3-6 para',
        long: 'Balanced momentum, character voice and sensory detail (3–6 paragraphs).',
      },
      long: {
        short: '5-8+ para',
        long: 'Multi-layered literary prose, subtext and atmosphere (5–8+ paragraphs).',
      },
    },
  } as const

  const lengthRanges = $derived(LENGTH_RANGES[mode] ?? LENGTH_RANGES.adventure)
  // Both come off disk, where the column is untyped text.
  const selectedLength = $derived<TargetLength>(
    targetLength && targetLength in lengthRanges ? targetLength : 'dynamic',
  )
  const lengthOptions: { id: TargetLength; label: string }[] = [
    { id: 'dynamic', label: 'Dynamic' },
    { id: 'short', label: 'Short' },
    { id: 'medium', label: 'Medium' },
    { id: 'long', label: 'Long' },
  ]
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
            class="border-muted bg-popover hover:bg-accent hover:text-accent-foreground has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-[:focus-visible]:ring-ring flex cursor-pointer flex-col items-center justify-center rounded-md border-2 p-3 text-center has-[:focus-visible]:ring-2"
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
      <p class="text-muted-foreground min-h-[1.25rem] text-xs">
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
            class="border-muted bg-popover hover:bg-accent hover:text-accent-foreground has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-[:focus-visible]:ring-ring flex cursor-pointer flex-col items-center justify-center rounded-md border-2 p-3 text-center has-[:focus-visible]:ring-2"
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
      <p class="text-muted-foreground min-h-[1.25rem] text-xs">
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

  <!-- Response Length -->
  {#if onTargetLengthChange}
    {@const lengthDisabled = !!targetLengthDisabledReason}
    <section class="space-y-2 pt-1">
      <Label class="flex items-center gap-2 text-base font-semibold">
        <AlignLeft class="h-4 w-4" />
        Response Length
      </Label>
      <RadioGroup.Root
        value={selectedLength}
        onValueChange={(v) => onTargetLengthChange?.(v as TargetLength)}
        disabled={lengthDisabled}
        class="grid grid-cols-2 gap-2 sm:grid-cols-4 {lengthDisabled ? 'opacity-50' : ''}"
      >
        {#each lengthOptions as item (item.id)}
          <Label
            for={`length-${item.id}`}
            class="border-muted bg-popover has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-[:focus-visible]:ring-ring flex flex-col items-center justify-center rounded-md border-2 p-3 text-center has-[:focus-visible]:ring-2 {lengthDisabled
              ? 'cursor-not-allowed'
              : 'hover:bg-accent hover:text-accent-foreground cursor-pointer'}"
          >
            <RadioGroup.Item value={item.id} id={`length-${item.id}`} class="sr-only" />
            <span class="font-medium">{item.label}</span>
            <span class="text-muted-foreground text-xs">{lengthRanges[item.id].short}</span>
          </Label>
        {/each}
      </RadioGroup.Root>
      <p
        class="min-h-[1.25rem] text-xs {lengthDisabled
          ? 'text-amber-500'
          : 'text-muted-foreground'}"
      >
        {targetLengthDisabledReason ?? lengthRanges[selectedLength].long}
      </p>
    </section>
  {/if}

  <!-- Visuals Configuration -->
  <section class="space-y-2 pt-1">
    <Label class="flex items-center gap-2 text-base font-semibold">
      <Eye class="h-4 w-4" />
      Visual Experience
    </Label>

    {#if imageProfileMissing}
      <p class="text-muted-foreground text-xs">
        Options without a configured image profile can only be turned off. Set one up in Settings →
        Images.
      </p>
    {/if}

    <RadioGroup.Root
      value={imageGenerationMode}
      onValueChange={(v) => onImageGenerationModeChange(v as ImageGenerationMode)}
      class="grid grid-cols-1 gap-4 md:grid-cols-3"
    >
      {#each IMAGE_MODES as option (option.value)}
        {@const locked = modeLocked(option.value)}
        <div class="relative" class:opacity-50={locked}>
          <Label
            for="img-{option.value}"
            class="border-muted bg-popover has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-[:focus-visible]:ring-ring flex h-full flex-col justify-between rounded-xl border-2 p-4 has-[:focus-visible]:ring-2 {locked
              ? 'cursor-not-allowed'
              : 'hover:bg-accent cursor-pointer'}"
          >
            <div class="mb-2 flex w-full items-start justify-between">
              <span class="font-semibold">{option.label}</span>
              <RadioGroup.Item
                value={option.value}
                id="img-{option.value}"
                disabled={locked}
                class="sr-only"
              />
            </div>
            <div class="text-muted-foreground text-xs font-normal">{option.description}</div>
          </Label>
        </div>
      {/each}
    </RadioGroup.Root>

    <!-- Extra Image Toggles -->
    <div class="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
      <div
        class="flex items-center space-x-2"
        class:opacity-50={!backgroundAvailable && !backgroundImagesEnabled}
      >
        <Switch
          id="bg-images"
          checked={backgroundImagesEnabled}
          disabled={!backgroundAvailable && !backgroundImagesEnabled}
          onCheckedChange={onBackgroundImagesEnabledChange}
        />
        <div class="grid gap-1.5 leading-none">
          <Label for="bg-images">Background Images</Label>
          <p class="text-muted-foreground text-xs">
            Generate immersive background images for scenes.
          </p>
        </div>
      </div>

      <div
        class="flex items-center space-x-2"
        class:opacity-50={!portraitAvailable && !referenceMode}
      >
        <Switch
          id="reference-mode"
          checked={referenceMode}
          disabled={!portraitAvailable && !referenceMode}
          onCheckedChange={onReferenceModeChange}
        />
        <div class="grid gap-1.5 leading-none">
          <Label for="reference-mode">Portrait Reference Mode</Label>
          <p class="text-muted-foreground text-xs">Use character portraits as visual references.</p>
        </div>
      </div>
    </div>
  </section>

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
