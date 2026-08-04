<script lang="ts">
  import type { Entry, EntryType } from '$lib/types'
  import {
    Users,
    MapPin,
    Package,
    Shield,
    Lightbulb,
    Calendar,
    BookOpen,
    ChevronRight,
  } from '@lucide/svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import { cn } from '$lib/utils/cn'

  interface Props {
    entry: Entry
    selected?: boolean
    showCheckbox?: boolean
    onSelect?: () => void
  }

  let { entry, selected = false, showCheckbox = false, onSelect }: Props = $props()

  const typeIcons: Record<EntryType, typeof Users> = {
    character: Users,
    location: MapPin,
    item: Package,
    faction: Shield,
    concept: Lightbulb,
    event: Calendar,
  }

  const typeColors: Record<EntryType, string> = {
    character: 'text-blue-400',
    location: 'text-green-400',
    item: 'text-amber-400',
    faction: 'text-purple-400',
    concept: 'text-pink-400',
    event: 'text-cyan-400',
  }

  const injectionLabels: Record<string, string> = {
    always: 'Always',
    keyword: 'Auto',
    relevant: 'Auto', // Same as keyword - both use keywords + AI
    never: 'Manual',
  }

  const Icon = $derived(typeIcons[entry.type] || BookOpen)
  const colorClass = $derived(typeColors[entry.type] || 'text-muted-foreground')
  const isSelected = $derived(ui.lorebookBulkSelection.has(entry.id))
  const keywordCount = $derived(entry.injection.keywords.length)

  function handleClick() {
    if (showCheckbox) {
      ui.toggleBulkSelection(entry.id)
    } else {
      onSelect?.()
    }
  }

  function handleCheckboxClick() {
    ui.toggleBulkSelection(entry.id)
  }
</script>

<button
  class={cn(
    'min-h-[56px] w-full rounded-lg border p-3 text-left transition-colors',
    selected ? 'bg-primary/10 border-primary/50' : 'bg-card hover:bg-muted/50 border-border',
  )}
  onclick={handleClick}
>
  <div class="flex items-center gap-3">
    {#if showCheckbox}
      <Checkbox
        checked={isSelected}
        onCheckedChange={handleCheckboxClick}
        class="h-4 w-4"
        onclick={(e) => e.stopPropagation()}
      />
    {/if}

    <div class={cn('flex-shrink-0', colorClass)}>
      <Icon class="h-5 w-5" />
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span class="text-foreground truncate font-medium">{entry.name}</span>
      </div>
      <div class="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
        <span class="capitalize">{entry.type}</span>
        {#if keywordCount > 0}
          <span class="opacity-50">|</span>
          <span>{keywordCount} keyword{keywordCount !== 1 ? 's' : ''}</span>
        {/if}
        <span class="opacity-50">|</span>
        <span class="capitalize">{injectionLabels[entry.injection.mode]}</span>
      </div>
    </div>

    <ChevronRight class="text-muted-foreground hidden h-4 w-4 flex-shrink-0 sm:block" />
  </div>
</button>
