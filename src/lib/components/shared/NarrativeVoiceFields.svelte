<!-- Perspective and tense, the two settings every narration is written to. -->
<script lang="ts">
  import * as RadioGroup from '#lib/components/ui/radio-group/index.ts'
  import { Label } from '#lib/components/ui/label/index.ts'
  import { BookOpen, User } from '@lucide/svelte'
  import { cn } from '#lib/utils/cn.ts'
  import type { POV, Tense } from '#lib/types/index.ts'

  interface Props {
    selectedPOV: POV
    selectedTense: Tense
    onPOVChange: (v: POV) => void
    onTenseChange: (v: Tense) => void
    disabled?: { pov?: boolean; tense?: boolean }
    /** Why a disabled field cannot change, shown under it. */
    reasons?: { pov?: string; tense?: string }
  }

  let { selectedPOV, selectedTense, onPOVChange, onTenseChange, disabled, reasons }: Props =
    $props()

  const uid = $props.id()
  const OPTION =
    'border-muted bg-popover hover:bg-accent hover:text-accent-foreground has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 has-focus-visible:ring-ring flex cursor-pointer flex-col items-center justify-center rounded-md border-2 p-3 text-center has-focus-visible:ring-2'
</script>

<section class="grid gap-4 sm:gap-8 md:grid-cols-2">
  <div class={cn('space-y-1', disabled?.pov && 'pointer-events-none opacity-50')}>
    <Label class="flex items-center gap-2 text-base font-semibold">
      <User class="h-4 w-4" />
      Perspective
    </Label>
    <RadioGroup.Root
      value={selectedPOV}
      onValueChange={(v) => onPOVChange(v as POV)}
      class="grid grid-cols-3 gap-2"
      disabled={disabled?.pov}
    >
      {#each ['first', 'second', 'third'] as pov, i (i)}
        <Label for={`${uid}-pov-${pov}`} class={OPTION}>
          <RadioGroup.Item
            value={pov}
            id={`${uid}-pov-${pov}`}
            class="sr-only"
            disabled={disabled?.pov}
          />
          <span class="font-medium capitalize">{pov}</span>
        </Label>
      {/each}
    </RadioGroup.Root>
    <p class="text-muted-foreground min-h-5 text-xs">
      {#if selectedPOV === 'first'}
        "I draw my sword..."
      {:else if selectedPOV === 'second'}
        "You draw your sword..."
      {:else}
        "He/She/They draw their sword..."
      {/if}
    </p>
    {#if disabled?.pov && reasons?.pov}
      <p class="text-muted-foreground/70 text-xs italic">{reasons.pov}</p>
    {/if}
  </div>

  <div class={cn('space-y-1', disabled?.tense && 'pointer-events-none opacity-50')}>
    <Label class="flex items-center gap-2 text-base font-semibold">
      <BookOpen class="h-4 w-4" />
      Tense
    </Label>
    <RadioGroup.Root
      value={selectedTense}
      onValueChange={(v) => onTenseChange(v as Tense)}
      class="grid grid-cols-2 gap-2"
      disabled={disabled?.tense}
    >
      {#each ['present', 'past'] as tense, i (i)}
        <Label for={`${uid}-tense-${tense}`} class={OPTION}>
          <RadioGroup.Item
            value={tense}
            id={`${uid}-tense-${tense}`}
            class="sr-only"
            disabled={disabled?.tense}
          />
          <span class="font-medium capitalize">{tense}</span>
        </Label>
      {/each}
    </RadioGroup.Root>
    <p class="text-muted-foreground min-h-5 text-xs">
      {#if selectedTense === 'present'}
        Action happens now.
      {:else}
        Action happened in the past.
      {/if}
    </p>
    {#if disabled?.tense && reasons?.tense}
      <p class="text-muted-foreground/70 text-xs italic">{reasons.tense}</p>
    {/if}
  </div>
</section>
