<script lang="ts">
  import * as Popover from '$lib/components/ui/popover'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { cn } from '$lib/utils/cn'
  import {
    Icon,
    Heart,
    Shield,
    Sword,
    Star,
    Flame,
    Zap,
    Crown,
    Eye,
    Brain,
    Target,
    Compass,
    Skull,
    Gem,
    Key,
    Lock,
    Map,
    Mountain,
    Droplet,
    Wind,
    Sun,
    Moon,
    Clock,
    Activity,
    AlertTriangle,
    Award,
    Battery,
    Bookmark,
    CircleDot,
    Crosshair,
    Feather,
    Flag,
    Gift,
    Globe,
    Hammer,
    Lightbulb,
    Music,
    Palette,
    Scale,
    Sparkles,
    Trophy,
    Wand2,
    Users,
    Gauge,
  } from 'lucide-svelte'

  interface Props {
    value?: string
    onSelect: (iconName: string | undefined) => void
  }

  let { value, onSelect }: Props = $props()

  let open = $state(false)
  let search = $state('')

  type IconEntry = { name: string; component: typeof Icon }

  const ICONS: IconEntry[] = [
    { name: 'Heart', component: Heart },
    { name: 'Shield', component: Shield },
    { name: 'Sword', component: Sword },
    { name: 'Star', component: Star },
    { name: 'Flame', component: Flame },
    { name: 'Zap', component: Zap },
    { name: 'Crown', component: Crown },
    { name: 'Eye', component: Eye },
    { name: 'Brain', component: Brain },
    { name: 'Target', component: Target },
    { name: 'Compass', component: Compass },
    { name: 'Skull', component: Skull },
    { name: 'Gem', component: Gem },
    { name: 'Key', component: Key },
    { name: 'Lock', component: Lock },
    { name: 'Map', component: Map },
    { name: 'Mountain', component: Mountain },
    { name: 'Droplet', component: Droplet },
    { name: 'Wind', component: Wind },
    { name: 'Sun', component: Sun },
    { name: 'Moon', component: Moon },
    { name: 'Clock', component: Clock },
    { name: 'Activity', component: Activity },
    { name: 'AlertTriangle', component: AlertTriangle },
    { name: 'Award', component: Award },
    { name: 'Battery', component: Battery },
    { name: 'Bookmark', component: Bookmark },
    { name: 'CircleDot', component: CircleDot },
    { name: 'Crosshair', component: Crosshair },
    { name: 'Feather', component: Feather },
    { name: 'Flag', component: Flag },
    { name: 'Gift', component: Gift },
    { name: 'Globe', component: Globe },
    { name: 'Hammer', component: Hammer },
    { name: 'Lightbulb', component: Lightbulb },
    { name: 'Music', component: Music },
    { name: 'Palette', component: Palette },
    { name: 'Scale', component: Scale },
    { name: 'Sparkles', component: Sparkles },
    { name: 'Trophy', component: Trophy },
    { name: 'Wand2', component: Wand2 },
    { name: 'Users', component: Users },
    { name: 'Gauge', component: Gauge },
  ]

  const ICON_MAP: globalThis.Map<string, IconEntry> = new globalThis.Map(
    ICONS.map((i) => [i.name, i]),
  )

  let filtered = $derived(
    search.trim()
      ? ICONS.filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase()))
      : ICONS,
  )

  let selectedIcon = $derived(value ? ICON_MAP.get(value) : undefined)

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
        {#if selectedIcon}
          <selectedIcon.component class="h-3.5 w-3.5" />
          <span class="text-muted-foreground">{selectedIcon.name}</span>
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
