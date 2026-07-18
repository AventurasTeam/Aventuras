<script lang="ts">
  import { tagStore } from '$lib/stores/tags.svelte'
  import type { VaultType } from '$lib/types'
  import { Check, Plus } from 'lucide-svelte'
  import TagBadge from './TagBadge.svelte'
  import { fade } from 'svelte/transition'

  interface Props {
    value: string[] // List of tag names
    type: VaultType
    placeholder?: string
    onChange: (tags: string[]) => void
  }

  let { value, type, placeholder = 'Add tags...', onChange }: Props = $props()

  let input = $state('')
  let isOpen = $state(false)
  let inputElement: HTMLInputElement

  // Derived state
  const allTags = $derived(tagStore.getTagsForType(type))

  const filteredTags = $derived.by(() => {
    const term = input.trim().toLowerCase()
    if (!term) return allTags.filter((t) => !value.includes(t.name))
    return allTags.filter((t) => t.name.toLowerCase().includes(term) && !value.includes(t.name))
  })

  const showCreateOption = $derived.by(() => {
    const term = input.trim()
    if (!term) return false
    // Don't show create if it already exists (case insensitive)
    return !allTags.some((t) => t.name.toLowerCase() === term.toLowerCase())
  })

  function addTag(tagName: string) {
    if (!value.includes(tagName)) {
      onChange([...value, tagName])
    }
    input = ''
    inputElement?.focus()
  }

  function removeTag(tagName: string) {
    onChange(value.filter((t) => t !== tagName))
  }

  async function createTag() {
    const term = input.trim()
    if (!term) return

    // Create new tag in store
    await tagStore.add(term, type)
    addTag(term)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredTags.length > 0) {
        addTag(filteredTags[0].name)
      } else if (showCreateOption) {
        createTag()
      }
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      // Remove last tag if input is empty
      removeTag(value[value.length - 1])
    } else if (e.key === 'Escape') {
      isOpen = false
      inputElement?.blur()
    }
  }

  // Close dropdown on click outside
  function handleClickOutside(node: HTMLElement) {
    const handleClick = (e: MouseEvent) => {
      if (!node.contains(e.target as Node)) {
        isOpen = false
      }
    }
    document.addEventListener('click', handleClick)
    return {
      destroy() {
        document.removeEventListener('click', handleClick)
      },
    }
  }
</script>

<div class="relative w-full" use:handleClickOutside>
  <div
    class="border-surface-600 bg-surface-700 focus-within:border-accent-500 flex cursor-text flex-wrap items-center gap-2 rounded-lg border p-2 transition-colors"
    onclick={() => {
      inputElement?.focus()
      isOpen = true
    }}
    role="button"
    tabindex="-1"
    onkeydown={() => {}}
  >
    {#each value as tagName, i (i)}
      <TagBadge
        name={tagName}
        color={tagStore.getColor(tagName, type)}
        onRemove={() => removeTag(tagName)}
      />
    {/each}

    <input
      bind:this={inputElement}
      bind:value={input}
      onfocus={() => (isOpen = true)}
      onkeydown={handleKeydown}
      {placeholder}
      class="text-surface-100 placeholder-surface-500 min-w-[80px] flex-1 bg-transparent text-sm focus:outline-none"
    />
  </div>

  {#if isOpen && (filteredTags.length > 0 || showCreateOption)}
    <div
      transition:fade={{ duration: 100 }}
      class="border-surface-600 bg-surface-800 absolute top-full left-0 z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border shadow-xl"
    >
      {#each filteredTags as tag (tag.id)}
        <button
          class="text-surface-200 hover:bg-surface-700 flex w-full items-center justify-between px-3 py-2 text-left text-sm"
          onclick={() => addTag(tag.name)}
        >
          <div class="flex items-center gap-2">
            <span class={`h-2 w-2 rounded-full bg-${tag.color}`}></span>
            {tag.name}
          </div>
          {#if value.includes(tag.name)}
            <Check class="text-accent-400 h-4 w-4" />
          {/if}
        </button>
      {/each}

      {#if showCreateOption}
        <button
          class="text-accent-400 hover:bg-surface-700 flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
          onclick={createTag}
        >
          <Plus class="h-4 w-4" />
          Create "{input}"
        </button>
      {/if}
    </div>
  {/if}
</div>
