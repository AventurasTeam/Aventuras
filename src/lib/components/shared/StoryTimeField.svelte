<!--
  A story-time input with its label above and, below it, what the text reads as, or why it reads
  as nothing. Below the field rather than beside it, so a long reading never widens the form.
-->
<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { Input } from '#lib/components/ui/input/index.ts'
  import { Label } from '#lib/components/ui/label/index.ts'
  import {
    formatStoryTime,
    normalizeTime,
    parseStoryTime,
    storyTimeIsInvalid,
  } from '#lib/services/storyTime/index.ts'
  import { cn } from '#lib/utils/cn.ts'

  interface Props extends Omit<HTMLInputAttributes, 'value' | 'size' | 'type' | 'files'> {
    label: string
    value?: string
    ref?: HTMLInputElement | null
    /** Reads the time as it is stored once carried over, so 25:00 reads as D2 01:00. */
    normalize?: boolean
    /** Valid spellings named when the text is not a time. */
    examples?: string
    compact?: boolean
  }

  let {
    label,
    value = $bindable(''),
    ref = $bindable(null),
    normalize = false,
    examples = '14:30, D4 14:30, or Y1 D4 14:30',
    compact = false,
    id,
    disabled,
    class: className,
    ...rest
  }: Props = $props()

  const uid = $props.id()
  const fieldId = $derived(id ?? `${uid}-time`)
  const invalid = $derived(storyTimeIsInvalid(value))
  const reading = $derived.by(() => {
    const parsed = disabled ? null : parseStoryTime(value)
    if (!parsed) return null
    return formatStoryTime(normalize ? normalizeTime(parsed) : parsed)
  })
</script>

<div class={cn('flex flex-col gap-1', className)}>
  <Label for={fieldId} class="text-xs">{label}</Label>
  <Input
    id={fieldId}
    type="text"
    fullWidth={false}
    bind:ref
    bind:value
    {disabled}
    class={cn(
      'w-full max-w-48',
      compact ? 'h-7 text-xs' : 'h-8 text-sm',
      invalid && 'border-destructive',
    )}
    {...rest}
  />
  <p class={cn('text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}>
    {#if invalid}
      Not a story time. Try {examples}.
    {:else if reading}
      = {reading}
    {:else}
      year, day, clock
    {/if}
  </p>
</div>
