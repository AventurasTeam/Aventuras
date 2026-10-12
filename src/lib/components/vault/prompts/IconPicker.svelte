<script lang="ts">
  import * as Popover from '#lib/components/ui/popover/index.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Input } from '#lib/components/ui/input/index.ts'
  import { cn } from '#lib/utils/cn.ts'
  import type { LucideIcon } from '@lucide/svelte'
  import { RUNTIME_VARIABLE_ICONS, runtimeVariableIcon } from './runtimeVariableIcons.ts'

  interface Props {
    value?: string
    onSelect: (iconName: string | undefined) => void
  }

  let { value, onSelect }: Props = $props()

  let open = $state(false)
  let search = $state('')

  type IconEntry = { name: string; component: LucideIcon }

  const ICONS: IconEntry[] = Object.entries(RUNTIME_VARIABLE_ICONS).map(([name, component]) => ({
    name,
    component,
  }))

  let filtered = $derived(
    search.trim()
      ? ICONS.filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase()))
      : ICONS,
  )

  let SelectedIcon = $derived(runtimeVariableIcon(value))

  function handleSelect(iconName: string | undefined) {
    onSelect(iconName)
    open = false
    search = ''
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs" {...props}>
        {#if SelectedIcon}
          <SelectedIcon class="h-3.5 w-3.5" />
          <span class="text-muted-foreground">{value}</span>
        {:else}
          <span class="text-muted-foreground">No icon</span>
        {/if}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-64 p-2" align="start">
    <Input bind:value={search} placeholder="Search icons..." class="mb-2 h-8 text-xs" />

    <!-- Clear option -->
    {#if value}
      <button
        type="button"
        class="text-muted-foreground hover:bg-muted hover:text-foreground mb-1 w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors"
        onclick={() => handleSelect(undefined)}
      >
        Clear icon
      </button>
    {/if}

    <!-- Icon grid -->
    <div class="grid max-h-48 grid-cols-6 gap-0.5 overflow-y-auto">
      {#each filtered as icon (icon.name)}
        <button
          type="button"
          class={cn(
            'flex items-center justify-center rounded-md p-2 transition-colors',
            value === icon.name
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted text-muted-foreground hover:text-foreground',
          )}
          title={icon.name}
          onclick={() => handleSelect(icon.name)}
        >
          <icon.component class="h-4 w-4" />
        </button>
      {/each}
    </div>

    {#if filtered.length === 0}
      <p class="text-muted-foreground py-4 text-center text-xs">No icons found</p>
    {/if}
  </Popover.Content>
</Popover.Root>
