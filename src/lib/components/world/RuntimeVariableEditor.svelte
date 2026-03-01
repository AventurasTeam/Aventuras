<script lang="ts">
  import type { RuntimeVariable } from '$lib/services/packs/types'
  import { Input } from '$lib/components/ui/input'
  import * as Select from '$lib/components/ui/select'
  import {
    Icon as LucideIcon,
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
    definition: RuntimeVariable
    currentValue: string | number | null
    onChange: (value: string | number | null) => void
  }

  let { definition, currentValue, onChange }: Props = $props()

  const ICON_MAP: Record<string, typeof LucideIcon> = {
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
  }

  let Icon = $derived(definition.icon ? (ICON_MAP[definition.icon] ?? null) : null)

  // Local state for text/number inputs (synced from props via $effect below)
  let textValue = $state('')
  let numValue = $state(0)
  let enumValue = $state('')

  // Sync external changes
  $effect(() => {
    textValue = currentValue != null ? String(currentValue) : ''
    numValue = currentValue != null ? Number(currentValue) : 0
    enumValue = currentValue != null ? String(currentValue) : ''
  })

  function handleTextChange(e: Event) {
    const val = (e.target as HTMLInputElement).value
    textValue = val
    onChange(val || null)
  }

  function handleNumberChange(e: Event) {
    const raw = (e.target as HTMLInputElement).value
    if (raw === '') {
      numValue = 0
      onChange(null)
      return
    }
    const parsed = Number(raw)
    if (!isNaN(parsed)) {
      numValue = parsed
      onChange(parsed)
    }
  }

  function handleEnumChange(val: string) {
    enumValue = val
    onChange(val || null)
  }

  function getEnumLabel(val: string): string {
    if (!definition.enumOptions) return val
    const opt = definition.enumOptions.find((o) => o.value === val)
    return opt?.label ?? val
  }
</script>

<div class="flex items-center gap-1.5">
  <!-- Icon or label -->
  {#if Icon}
    <div class="flex w-5 shrink-0 items-center justify-center" title={definition.displayName}>
      <Icon class="h-3.5 w-3.5" style="color: {definition.color}" />
    </div>
  {:else}
    <span class="text-muted-foreground max-w-[80px] min-w-0 shrink-0 truncate text-xs">
      {definition.displayName}
    </span>
  {/if}

  <!-- Editor -->
  <div class="min-w-0 flex-1">
    {#if definition.variableType === 'text'}
      <Input
        type="text"
        value={textValue}
        oninput={handleTextChange}
        placeholder="Not set"
        class="h-7 text-xs"
      />
    {:else if definition.variableType === 'number'}
      <Input
        type="number"
        value={numValue}
        oninput={handleNumberChange}
        min={definition.minValue}
        max={definition.maxValue}
        placeholder="0"
        class="h-7 text-xs tabular-nums"
      />
    {:else if definition.variableType === 'enum'}
      <Select.Root type="single" value={enumValue} onValueChange={handleEnumChange}>
        <Select.Trigger class="h-7 w-full text-xs">
          <div class="flex items-center gap-2 overflow-hidden">
            <span class="truncate">
              {enumValue ? getEnumLabel(enumValue) : 'Not set'}
            </span>
          </div>
        </Select.Trigger>
        <Select.Content>
          {#if definition.enumOptions}
            {#each definition.enumOptions as opt (opt.value)}
              <Select.Item value={opt.value} label={opt.label}>{opt.label}</Select.Item>
            {/each}
          {/if}
        </Select.Content>
      </Select.Root>
    {/if}
  </div>
</div>
