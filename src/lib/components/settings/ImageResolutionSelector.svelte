<script lang="ts">
  import {
    parseImageSpec,
    specToPixels,
    specToRatioString,
    IMAGE_ORIENTATIONS,
    IMAGE_SIZE_TIERS,
    type ImageSpec,
    type ImageOrientation,
    type ImageSizeTier,
  } from '$lib/utils/image'
  import { Label } from '$lib/components/ui/label'
  import { Square, RectangleHorizontal, RectangleVertical, Scaling } from '@lucide/svelte'
  import { cn } from '$lib/utils/cn'

  /**
   * Orientation + size tier. No pixel field, because there is no pixel size every backend
   * accepts — see `$lib/utils/image`.
   */
  interface Props {
    label?: string
    /** A settings value: an `ImageSpec`, or a `WIDTHxHEIGHT` string from an older build. */
    size: ImageSpec | string
    onSizeChange: (spec: ImageSpec) => void
  }

  let { label, size, onSizeChange }: Props = $props()

  const spec = $derived(parseImageSpec(size))

  const ORIENTATION_META: Record<ImageOrientation, { label: string; icon: typeof Square }> = {
    square: { label: 'Square', icon: Square },
    landscape: { label: 'Landscape', icon: RectangleHorizontal },
    portrait: { label: 'Portrait', icon: RectangleVertical },
  }

  const SIZE_META: Record<ImageSizeTier, { label: string; hint: string; icon: string }> = {
    tiny: { label: 'Tiny', hint: 'Fastest and cheapest', icon: 'h-2.5 w-2.5' },
    small: { label: 'Small', hint: 'Quick', icon: 'h-3 w-3' },
    medium: { label: 'Medium', hint: 'Balanced', icon: 'h-4 w-4' },
    large: { label: 'Large', hint: 'Slowest, most detail', icon: 'h-5 w-5' },
  }

  // Labelled with the dimensions rather than with Small/Medium/Large, and they follow the
  // orientation: pick Portrait and the row relabels from 1536×864 to 864×1536.
  const sizeOptions = $derived(
    IMAGE_SIZE_TIERS.map((tier) => ({
      tier,
      pixels: specToPixels({ orientation: spec.orientation, size: tier }),
    })),
  )

  const segment =
    'flex flex-col items-center justify-center gap-1 rounded-md border px-1.5 py-2 transition-colors'
  const segmentOn = 'border-primary/60 bg-primary/10 text-foreground font-semibold'
  const segmentOff = 'border-border/40 bg-background/60 text-muted-foreground hover:bg-accent/40'
</script>

<div class="border-border/40 bg-card/30 space-y-2 rounded-lg border p-2.5 shadow-xs">
  {#if label}
    <div class="flex items-center gap-1.5">
      <Scaling class="text-muted-foreground h-4 w-4" />
      <Label class="text-foreground/90 text-xs font-semibold">{label}</Label>
    </div>
  {/if}

  <div class="grid grid-cols-3 gap-1.5">
    {#each IMAGE_ORIENTATIONS as orientation (orientation)}
      {@const meta = ORIENTATION_META[orientation]}
      {@const Icon = meta.icon}
      <button
        type="button"
        class={cn(segment, spec.orientation === orientation ? segmentOn : segmentOff)}
        aria-pressed={spec.orientation === orientation}
        title={specToRatioString({ orientation, size: spec.size })}
        onclick={() => onSizeChange({ ...spec, orientation })}
      >
        <Icon class="h-4 w-4" />
        <span class="text-xs">{meta.label}</span>
      </button>
    {/each}
  </div>

  <!-- Two columns below `sm`: four dimension labels do not fit a phone in one row. -->
  <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
    {#each sizeOptions as option (option.tier)}
      {@const meta = SIZE_META[option.tier]}
      {@const SizeIcon = ORIENTATION_META[spec.orientation].icon}
      <button
        type="button"
        class={cn(segment, spec.size === option.tier ? segmentOn : segmentOff)}
        aria-pressed={spec.size === option.tier}
        aria-label={`${meta.label}, ${option.pixels.width}×${option.pixels.height} — ${meta.hint}`}
        title={meta.hint}
        onclick={() => onSizeChange({ ...spec, size: option.tier })}
      >
        <SizeIcon class={meta.icon} />
        <span class="font-mono text-[11px] whitespace-nowrap">
          {option.pixels.width}×{option.pixels.height}
        </span>
      </button>
    {/each}
  </div>

  <p class="text-muted-foreground/75 text-[10px] font-medium">
    Approximate — providers that only accept an aspect ratio are sent the shape, not the pixels.
  </p>
</div>
