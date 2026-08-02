<script lang="ts">
  import { tagStore } from '$lib/stores/tags.svelte'
  import type { VaultType } from '$lib/types'
  import { Filter, Check, X } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import { Badge } from '$lib/components/ui/badge'
  import * as Command from '$lib/components/ui/command'
  import * as Popover from '$lib/components/ui/popover'
  import { cn } from '$lib/utils/cn'

  interface Props {
    selectedTags: string[]
    logic: 'AND' | 'OR'
    type: VaultType
    onUpdate: (tags: string[], logic: 'AND' | 'OR') => void
  }

  let { selectedTags, logic, type, onUpdate }: Props = $props()

  let open = $state(false)

  const availableTags = $derived(tagStore.getTagsForType(type))

  function toggleTag(tagName: string) {
    if (selectedTags.includes(tagName)) {
      onUpdate(
        selectedTags.filter((t) => t !== tagName),
        logic,
      )
    } else {
      onUpdate([...selectedTags, tagName], logic)
    }
  }

  function clearTags() {
    onUpdate([], logic)
    open = false
  }

  function toggleLogic() {
    onUpdate(selectedTags, logic === 'AND' ? 'OR' : 'AND')
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        variant={selectedTags.length > 0 ? 'secondary' : 'outline'}
        size="default"
        class={cn('gap-2', selectedTags.length > 0 && 'bg-secondary text-secondary-foreground')}
        {...props}
      >
        <Filter class="h-3 w-3" />
        <span class="hidden sm:inline">Tags</span>
        {#if selectedTags.length > 0}
          <Badge variant="secondary" class="h-5 px-0 text-sm">
            {selectedTags.length}
          </Badge>
        {/if}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-70 p-0" align="end">
    <!-- Logic Toggle Header -->
    <div class="flex items-center justify-between border-b px-3 py-2">
      <span class="text-muted-foreground text-xs font-medium">Filter Logic:</span>
      <div class="bg-muted flex items-center rounded-md p-0.5">
        <button
          class={cn(
            'rounded-sm px-2 py-0.5 text-[10px] font-bold transition-all',
            logic === 'AND'
              ? 'bg-background text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onclick={toggleLogic}
        >
          AND
        </button>
        <button
          class={cn(
            'rounded-sm px-2 py-0.5 text-[10px] font-bold transition-all',
            logic === 'OR'
              ? 'bg-background text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onclick={toggleLogic}
        >
          OR
        </button>
      </div>
    </div>

    <!-- Command List -->
    <Command.Root>
      <Command.Input placeholder="Filter tags..." class="h-9" />
      <Command.List class="max-h-[200px]">
        <Command.Empty>No tags found.</Command.Empty>
        <Command.Group>
          {#each availableTags as tag, i (i)}
            <Command.Item
              value={tag.name}
              onSelect={() => toggleTag(tag.name)}
              class="cursor-pointer"
            >
              <div
                class={cn(
                  'border-primary mr-2 flex h-4 w-4 items-center justify-center rounded-sm border',
                  selectedTags.includes(tag.name)
                    ? 'bg-primary text-primary-foreground'
                    : 'opacity-50 [&_svg]:invisible',
                )}
              >
                <Check class={cn('h-4 w-4')} />
              </div>
              <span>{tag.name}</span>
            </Command.Item>
          {/each}
        </Command.Group>
      </Command.List>
    </Command.Root>

    <!-- Clear Footer -->
    {#if selectedTags.length > 0}
      <div class="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          class="h-8 w-full justify-center text-xs"
          onclick={clearTags}
        >
          <X class="mr-2 h-3 w-3" />
          Clear Filters
        </Button>
      </div>
    {/if}
  </Popover.Content>
</Popover.Root>
