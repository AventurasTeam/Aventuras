<script lang="ts">
  import { X } from '@lucide/svelte'

  interface Props {
    name: string
    color?: string
    onRemove?: () => void
    class?: string
  }

  let { name, color = 'bg-surface-600', onRemove, class: className = '' }: Props = $props()

  // Map of color names to Tailwind classes if needed, or assume 'color' is a tailwind color suffix like 'red-500'
  // If the color prop is just 'red-500', we need to construct the full class
  const bgClass = $derived(
    color.startsWith('bg-') ? color : `bg-${color}/20 text-${color} border-${color}/30`,
  )
</script>

<span
  class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium {bgClass} {className}"
>
  {name}
  {#if onRemove}
    <button
      type="button"
      onclick={(e) => {
        e.stopPropagation()
        onRemove()
      }}
      class="ml-0.5 rounded-sm p-0.5 hover:bg-black/20"
    >
      <X class="h-3 w-3" />
      <span class="sr-only">Remove {name}</span>
    </button>
  {/if}
</span>
