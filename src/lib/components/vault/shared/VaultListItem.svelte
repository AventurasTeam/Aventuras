<script lang="ts">
  import { cn } from '#lib/utils/cn.ts'
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    subtitle?: string
    selected?: boolean
    disabled?: boolean
    onclick?: () => void
    class?: string

    // Slots
    icon?: Snippet
    badges?: Snippet
    end?: Snippet // For right-aligned content like badges
  }

  let {
    title,
    subtitle,
    selected = false,
    disabled = false,
    onclick,
    class: className,
    icon,
    badges,
    end,
  }: Props = $props()
</script>

<button
  class={cn(
    'group focus-visible:ring-ring relative flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all focus-visible:ring-2 focus-visible:outline-none',
    selected
      ? 'border-primary bg-primary/5 ring-primary ring-1'
      : 'border-muted bg-card hover:bg-accent hover:text-accent-foreground hover:border-primary/50 shadow-sm',
    disabled && 'hover:bg-card hover:border-muted cursor-not-allowed opacity-50',
    className,
  )}
  {onclick}
  {disabled}
  type="button"
>
  <!-- Icon Slot -->
  {#if icon}
    <div class="flex shrink-0 items-center justify-center">
      {@render icon()}
    </div>
  {/if}

  <!-- Content -->
  <div class="min-w-0 flex-1">
    <div class="flex items-center justify-between gap-2">
      <h4 class="text-foreground truncate text-sm leading-none font-medium">
        {title}
      </h4>
      {#if end}
        {@render end()}
      {/if}
    </div>

    {#if subtitle}
      <p class="text-muted-foreground mt-1 truncate text-xs">
        {subtitle}
      </p>
    {/if}

    {#if badges}
      <div class="mt-1.5 flex flex-wrap gap-1">
        {@render badges()}
      </div>
    {/if}
  </div>
</button>
