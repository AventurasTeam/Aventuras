<script lang="ts">
  import * as Popover from '$lib/components/ui/popover'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { cn } from '$lib/utils/cn'
  import { Check } from 'lucide-svelte'

  interface Props {
    value: string
    onChange: (color: string) => void
  }

  let { value, onChange }: Props = $props()

  let open = $state(false)
  let customHex = $state('')

  const COLORS = [
    // Reds / Pinks
    '#ef4444',
    '#dc2626',
    '#f43f5e',
    '#e11d48',
    '#ec4899',
    '#db2777',
    // Oranges / Ambers
    '#f97316',
    '#ea580c',
    '#f59e0b',
    '#d97706',
    '#eab308',
    '#ca8a04',
    // Greens
    '#84cc16',
    '#65a30d',
    '#22c55e',
    '#16a34a',
    '#10b981',
    '#059669',
    // Teals / Cyans
    '#14b8a6',
    '#0d9488',
    '#06b6d4',
    '#0891b2',
    '#22d3ee',
    '#67e8f9',
    // Blues
    '#3b82f6',
    '#2563eb',
    '#1d4ed8',
    '#60a5fa',
    '#0ea5e9',
    '#0284c7',
    // Indigos / Purples
    '#6366f1',
    '#4f46e5',
    '#8b5cf6',
    '#7c3aed',
    '#a855f7',
    '#9333ea',
    // Neutrals
    '#78716c',
    '#57534e',
    '#64748b',
    '#475569',
    '#a1a1aa',
    '#d4d4d8',
  ]

  const isCustom = $derived(!COLORS.includes(value))

  function handleSelect(color: string) {
    onChange(color)
    open = false
  }

  function handleCustomInput(e: Event) {
    const raw = (e.currentTarget as HTMLInputElement).value
    customHex = raw
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
      onChange(raw.toLowerCase())
    }
  }

  function handleNativeColor(e: Event) {
    const color = (e.currentTarget as HTMLInputElement).value
    customHex = color
    onChange(color)
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button variant="outline" size="icon" class="h-8 w-8" {...props}>
        <div class="h-4 w-4 rounded-sm" style:background-color={value}></div>
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-auto p-3" align="start">
    <div class="grid grid-cols-6 gap-1.5">
      {#each COLORS as color (color)}
        <button
          type="button"
          class={cn(
            'flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110',
            value === color && 'ring-primary ring-2 ring-offset-1',
          )}
          style:background-color={color}
          onclick={() => handleSelect(color)}
        >
          {#if value === color}
            <Check class="h-3 w-3 text-white drop-shadow-sm" />
          {/if}
        </button>
      {/each}
    </div>
    <!-- Custom color -->
    <div class="border-border mt-2 flex items-center gap-2 border-t pt-2">
      <label class="relative shrink-0 cursor-pointer">
        <div
          class={cn(
            'flex h-6 w-6 items-center justify-center rounded-full',
            isCustom && 'ring-primary ring-2 ring-offset-1',
          )}
          style:background-color={value}
        >
          {#if isCustom}
            <Check class="h-3 w-3 text-white drop-shadow-sm" />
          {/if}
        </div>
        <input
          type="color"
          {value}
          oninput={handleNativeColor}
          class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <Input
        type="text"
        value={isCustom ? value : customHex}
        oninput={handleCustomInput}
        placeholder="#a1b2c3"
        class="h-7 w-24 font-mono text-xs"
        maxlength={7}
      />
    </div>
  </Popover.Content>
</Popover.Root>
