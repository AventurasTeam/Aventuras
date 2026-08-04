<script lang="ts" generics="T">
  import { Check, ChevronsUpDown, Plus } from '@lucide/svelte'
  import VirtualList from '@tutorlatin/svelte-tiny-virtual-list'
  import * as Command from '$lib/components/ui/command'
  import * as Popover from '$lib/components/ui/popover'
  import { Button } from '$lib/components/ui/button'
  import { cn } from '$lib/utils/cn'
  import type { Snippet } from 'svelte'

  interface Props {
    items: T[] | readonly T[]
    selected: T | T[] | undefined
    onSelect: (item: T | T[] | undefined) => void
    multiple?: boolean
    label?: string
    placeholder?: string
    searchPlaceholder?: string
    itemLabel: (item: T) => string
    itemValue: (item: T) => string
    allowCustom?: boolean
    onCustomSelect?: (value: string) => void
    virtualized?: boolean
    itemHeight?: number
    maxHeight?: number
    class?: string
    itemSnippet?: Snippet<[T, number]>
    triggerSnippet?: Snippet
    disabled?: boolean
  }

  let {
    items,
    selected = $bindable(),
    onSelect,
    multiple = false,
    placeholder = 'Select item...',
    searchPlaceholder = 'Search...',
    itemLabel,
    itemValue,
    allowCustom = false,
    onCustomSelect,
    virtualized = true,
    itemHeight = 36,
    maxHeight = 300,
    class: className,
    itemSnippet,
    triggerSnippet,
    disabled = false,
  }: Props = $props()

  let open = $state(false)
  let inputValue = $state('')

  let filteredItems = $derived.by(() => {
    if (!inputValue.trim()) return items
    const search = inputValue.toLowerCase()
    return items.filter((item) => itemLabel(item).toLowerCase().includes(search))
  })

  let inputMatchesExisting = $derived(
    items.some((item) => itemLabel(item).toLowerCase() === inputValue.toLowerCase()),
  )

  let showCustomOption = $derived(allowCustom && inputValue.length > 0 && !inputMatchesExisting)

  let totalItemCount = $derived(filteredItems.length + (showCustomOption ? 1 : 0))
  let listHeight = $derived(Math.min(totalItemCount * itemHeight, maxHeight))

  function isSelected(item: T) {
    if (multiple) {
      if (!Array.isArray(selected)) return false
      return selected.some((s) => itemValue(s) === itemValue(item))
    }
    return selected && itemValue(selected as T) === itemValue(item)
  }

  function handleSelect(item: T) {
    if (multiple) {
      const current = Array.isArray(selected) ? [...selected] : []
      const index = current.findIndex((s) => itemValue(s) === itemValue(item))
      if (index >= 0) {
        current.splice(index, 1)
      } else {
        current.push(item)
      }
      selected = current
    } else {
      selected = item
      open = false
      inputValue = ''
    }
    onSelect(selected)
  }

  function handleCustomSelection() {
    if (onCustomSelect) {
      onCustomSelect(inputValue)
      open = false
      inputValue = ''
    }
  }

  let triggerLabel = $derived.by(() => {
    if (multiple) {
      const arr = Array.isArray(selected) ? selected : []
      if (arr.length === 0) return placeholder
      if (arr.length === 1) return itemLabel(arr[0])
      return `${arr.length} selected`
    }
    return selected ? itemLabel(selected as T) : placeholder
  })

  // Calculate the index of the selected item in the filtered list
  let selectedIndex = $derived.by(() => {
    if (!selected || multiple) return -1
    const val = Array.isArray(selected) ? '' : itemValue(selected as T)
    return filteredItems.findIndex((item) => itemValue(item) === val)
  })

  // State to track if we should perform the initial scroll
  let initialScrollDone = $state(false)
  let delayedScrollIndex = $state(-1)

  // Handle scrolling for virtualized list
  $effect(() => {
    if (open) {
      if (!initialScrollDone) {
        // Delay to let VirtualList initialize and measure
        const timer = setTimeout(() => {
          if (selectedIndex >= 0) {
            delayedScrollIndex = showCustomOption ? selectedIndex + 1 : selectedIndex
          }
          initialScrollDone = true
        }, 150)
        return () => clearTimeout(timer)
      }
    } else {
      initialScrollDone = false
      delayedScrollIndex = -1
    }
  })

  // Handle scrolling for non-virtualized list
  $effect(() => {
    if (open && !virtualized && selectedIndex >= 0) {
      // Find the selected item element after the popover has opened and rendered
      setTimeout(() => {
        const selectedEl = document.querySelector(
          `[data-autocomplete-item-index="${selectedIndex}"]`,
        )
        if (selectedEl) {
          selectedEl.scrollIntoView({ block: 'nearest' })
        }
      }, 100)
    }
  })
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        variant="outline"
        role="combobox"
        aria-expanded={open}
        class={cn('w-full justify-between', className)}
        {disabled}
        {...props}
      >
        {#if triggerSnippet}
          {@render triggerSnippet()}
        {:else}
          <span class="truncate">{triggerLabel}</span>
        {/if}
        <ChevronsUpDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-[var(--bits-popover-anchor-width)] p-0">
    <Command.Root shouldFilter={false} filter={() => 1}>
      <Command.Input bind:value={inputValue} placeholder={searchPlaceholder} />
      <Command.List class={virtualized ? 'overflow-hidden' : ''}>
        {#if totalItemCount === 0}
          <Command.Empty>No items found.</Command.Empty>
        {:else}
          <Command.Group class={virtualized ? 'p-0' : ''}>
            {#if virtualized}
              {#key inputValue}
                <div class="virtual-list-container">
                  <VirtualList
                    height={listHeight}
                    itemCount={totalItemCount}
                    itemSize={itemHeight}
                    scrollToIndex={delayedScrollIndex}
                    scrollToAlignment="auto"
                  >
                    {#snippet item({ style, index })}
                      <div {style}>
                        {#if showCustomOption && index === 0}
                          <Command.Item
                            value={`__custom__${inputValue}`}
                            onSelect={handleCustomSelection}
                          >
                            <Plus class="mr-2 h-4 w-4" />
                            Use "{inputValue}"
                          </Command.Item>
                        {:else}
                          {@const itemIndex = showCustomOption ? index - 1 : index}
                          {@const itemData = filteredItems[itemIndex]}
                          <Command.Item
                            value={itemValue(itemData)}
                            onSelect={() => handleSelect(itemData)}
                          >
                            {#if itemSnippet}
                              {@render itemSnippet(itemData, itemIndex)}
                            {:else}
                              <Check
                                class={cn(
                                  'mr-2 h-4 w-4',
                                  isSelected(itemData) ? 'opacity-100' : 'opacity-0',
                                )}
                              />
                              <span class="truncate">{itemLabel(itemData)}</span>
                            {/if}
                          </Command.Item>
                        {/if}
                      </div>
                    {/snippet}
                  </VirtualList>
                </div>
              {/key}
            {:else}
              {#if showCustomOption}
                <Command.Item value={`__custom__${inputValue}`} onSelect={handleCustomSelection}>
                  <Plus class="mr-2 h-4 w-4" />
                  Use "{inputValue}"
                </Command.Item>
              {/if}
              {#each filteredItems as itemData, i (i)}
                <Command.Item
                  value={itemValue(itemData)}
                  onSelect={() => handleSelect(itemData)}
                  data-autocomplete-item-index={i}
                >
                  {#if itemSnippet}
                    {@render itemSnippet(itemData, i)}
                  {:else}
                    <Check
                      class={cn('mr-2 h-4 w-4', isSelected(itemData) ? 'opacity-100' : 'opacity-0')}
                    />
                    <span class="truncate">{itemLabel(itemData)}</span>
                  {/if}
                </Command.Item>
              {/each}
            {/if}
          </Command.Group>
        {/if}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>

<style>
  .virtual-list-container :global(.virtual-list-wrapper) {
    overflow-y: auto;
  }

  .virtual-list-container :global(.virtual-list-inner) {
    position: relative;
  }
</style>
