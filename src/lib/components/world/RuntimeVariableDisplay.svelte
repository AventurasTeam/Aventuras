<script lang="ts">
  import type {
    RuntimeVariable,
    RuntimeVarsMap,
    RuntimeVariableValue,
  } from '$lib/services/packs/types'
  import RuntimeVariableEditor from './RuntimeVariableEditor.svelte'
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
    definitions: RuntimeVariable[]
    values: RuntimeVarsMap | undefined
    onValueChange?: (defId: string, value: string | number | null) => void
    editMode?: boolean
    /** Filter by pinned state: true = only pinned, false = only non-pinned, undefined = show all */
    pinnedOnly?: boolean
    class?: string
  }

  let {
    definitions,
    values,
    onValueChange,
    editMode = false,
    pinnedOnly = undefined,
    class: className = '',
  }: Props = $props()

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

  const sorted = $derived([...definitions].sort((a, b) => a.sortOrder - b.sortOrder))

  const filtered = $derived(
    pinnedOnly === undefined
      ? sorted
      : pinnedOnly
        ? sorted.filter((d) => d.pinned)
        : sorted.filter((d) => !d.pinned),
  )

  function getValue(def: RuntimeVariable): RuntimeVariableValue | undefined {
    return values?.[def.id]
  }

  function getRawValue(def: RuntimeVariable): string | number | null {
    return getValue(def)?.v ?? null
  }

  function getEnumLabel(def: RuntimeVariable, val: string | number | null): string {
    if (val == null || !def.enumOptions) return 'Not set'
    const strVal = String(val)
    const opt = def.enumOptions.find((o) => o.value === strVal)
    return opt?.label ?? strVal
  }

  function getProgressPercent(def: RuntimeVariable, val: number): number {
    const min = def.minValue ?? 0
    const max = def.maxValue ?? 100
    if (max === min) return 100
    return Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100))
  }

  function hasMinMax(def: RuntimeVariable): boolean {
    return def.minValue != null && def.maxValue != null
  }

  function getIconComponent(iconName?: string) {
    if (!iconName) return null
    return ICON_MAP[iconName] ?? null
  }
</script>

{#if filtered.length > 0}
  <div class="flex flex-col gap-1 {className}">
    {#if editMode && onValueChange}
      <!-- Edit mode: vertical list of inline editors -->
      {#each filtered as def (def.id)}
        {@const rawVal = getRawValue(def)}
        <RuntimeVariableEditor
          definition={def}
          currentValue={rawVal}
          onChange={(v) => onValueChange(def.id, v)}
        />
      {/each}
    {:else}
      <!-- Display mode: vertical stat rows -->
      {#each filtered as def (def.id)}
        {@const rawVal = getRawValue(def)}
        {@const isSet = rawVal != null}
        {@const Icon = getIconComponent(def.icon)}

        <div
          class="rounded-md px-2 py-1"
          style="background-color: color-mix(in srgb, {def.color} {isSet
            ? '10%'
            : '5%'}, transparent)"
        >
          <!-- Label row: icon/name on left, value on right -->
          <div class="flex items-center gap-1.5">
            {#if Icon}
              <span title={def.displayName}>
                <Icon
                  class="h-3.5 w-3.5 shrink-0 {isSet ? '' : 'opacity-40'}"
                  style="color: {def.color}"
                />
              </span>
            {:else}
              <span
                class="text-[11px] font-medium whitespace-nowrap {isSet ? '' : 'opacity-40'}"
                style="color: {def.color}"
              >
                {def.displayName}
              </span>
            {/if}

            {#if def.variableType === 'number'}
              {#if isSet}
                <span class="ml-auto text-xs font-bold tabular-nums" style="color: {def.color}">
                  {rawVal}{#if hasMinMax(def)}<span class="opacity-50">/{def.maxValue}</span>{/if}
                </span>
              {:else}
                <span class="ml-auto text-[10px] italic opacity-40">--</span>
              {/if}
            {:else if def.variableType === 'enum'}
              {#if isSet}
                <span class="ml-auto text-[11px] font-semibold" style="color: {def.color}">
                  {getEnumLabel(def, rawVal)}
                </span>
              {:else}
                <span class="ml-auto text-[10px] italic opacity-40">--</span>
              {/if}
            {:else}
              <!-- Text: "not set" indicator on right when empty -->
              {#if !isSet}
                <span class="ml-auto text-[10px] italic opacity-40">--</span>
              {/if}
            {/if}
          </div>

          <!-- Full-width progress bar for number with range -->
          {#if def.variableType === 'number' && hasMinMax(def)}
            <div class="bg-muted/50 mt-1 h-1.5 w-full overflow-hidden rounded-full">
              {#if isSet && typeof rawVal === 'number'}
                <div
                  class="h-full rounded-full"
                  style="width: {getProgressPercent(
                    def,
                    rawVal,
                  )}%; background-color: {def.color}; opacity: 0.7"
                ></div>
              {/if}
            </div>
          {/if}

          <!-- Full text value below label -->
          {#if def.variableType === 'text' && isSet}
            <p class="mt-0.5 text-[11px] leading-snug" style="color: {def.color}; opacity: 0.8">
              {rawVal}
            </p>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
{/if}
