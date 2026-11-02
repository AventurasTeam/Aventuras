<!--
  A story-time input with its label above. The time is stored carried over, so when what was typed
  overflows (D400 is Y2 D35) an (i) beside the field opens what it is stored as. Otherwise the field
  says nothing more, apart from the error when the text is not a time.
-->
<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { Info } from '@lucide/svelte'
  import { Input } from '#lib/components/ui/input/index.ts'
  import { Label } from '#lib/components/ui/label/index.ts'
  import * as Popover from '#lib/components/ui/popover/index.ts'
  import { convertedStoryTime, storyTimeIsInvalid } from '#lib/services/storyTime/index.ts'
  import { cn } from '#lib/utils/cn.ts'

  interface Props extends Omit<HTMLInputAttributes, 'value' | 'size' | 'type' | 'files'> {
    label: string
    value?: string
    ref?: HTMLInputElement | null
    compact?: boolean
  }

  let {
    label,
    value = $bindable(''),
    ref = $bindable(null),
    compact = false,
    id,
    disabled,
    class: className,
    ...rest
  }: Props = $props()

  const uid = $props.id()
  const fieldId = $derived(id ?? `${uid}-time`)
  const invalid = $derived(storyTimeIsInvalid(value))
  const converted = $derived(disabled ? null : convertedStoryTime(value))
</script>

<div class={cn('flex flex-col gap-1', className)}>
  <Label for={fieldId} class="text-xs">{label}</Label>
  <div class="flex items-center gap-1.5">
    <Input
      id={fieldId}
      type="text"
      fullWidth={false}
      bind:ref
      bind:value
      {disabled}
      class={cn(
        // Sized for Y999999 D9999 23:59, plus its padding and border; longer text scrolls inside.
        'w-[calc(19ch+1.5rem+2px)] max-w-full',
        compact ? 'h-7 text-xs' : 'h-8 text-sm',
        invalid && 'border-destructive',
      )}
      {...rest}
    />
    {#if converted}
      <Popover.Root>
        <Popover.Trigger
          class="text-muted-foreground hover:text-foreground shrink-0 rounded-full"
          aria-label="What this time is stored as"
        >
          <Info class={compact ? 'size-3.5' : 'size-4'} />
        </Popover.Trigger>
        <Popover.Content class="w-auto px-3 py-2 text-xs" align="start">
          Converted to <span class="font-medium">{converted}</span>
        </Popover.Content>
      </Popover.Root>
    {/if}
  </div>
  {#if invalid}
    <p class="text-destructive text-xs">Not a story time. Try 14:30, D4 14:30, or Y1 D4 14:30.</p>
  {/if}
</div>
