<script lang="ts">
  import { story } from '$lib/stores/story/index.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { onDestroy } from 'svelte'
  import { slide } from 'svelte/transition'
  import { createDebouncedSave } from '$lib/utils/debounce'
  import { Card, CardContent } from '$lib/components/ui/card'
  import { Slider } from '$lib/components/ui/slider'
  import { Label } from '$lib/components/ui/label'
  import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group'

  // Local state for editing — seeded from store, written back on debounced save
  let localThreshold = $state(story.settings.memoryConfig.tokenThreshold)
  let localBuffer = $state(story.settings.memoryConfig.chapterBuffer)

  // Single debounced save: flushes both values in one call
  const { trigger, flush } = createDebouncedSave(() =>
    story.settings.updateMemoryConfig({
      tokenThreshold: localThreshold,
      chapterBuffer: localBuffer,
    }),
  )

  function scheduleThresholdSave(value: number) {
    localThreshold = value
    trigger()
  }

  function scheduleBufferSave(value: number) {
    localBuffer = value
    trigger()
  }

  onDestroy(() => flush())

  function formatNumber(num: number): string {
    return num.toLocaleString()
  }

  // Threshold presets
  const thresholdPresets = [
    { label: '8K', value: 8000 },
    { label: '16K', value: 16000 },
    { label: '24K', value: 24000 },
    { label: '32K', value: 32000 },
    { label: '48K', value: 48000 },
  ]
</script>

{#if ui.memorySettingsOpen}
  <div transition:slide={{ duration: 200 }}>
    <Card class="mt-4">
      <CardContent class="space-y-4 p-4">
        <h3 class="text-foreground text-sm font-medium">Memory Settings</h3>

        <!-- Token Threshold -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <Label for="token-threshold" class="text-muted-foreground">Token Threshold</Label>
            <span class="text-foreground text-sm font-medium">{formatNumber(localThreshold)}</span>
          </div>

          <Slider
            id="token-threshold"
            value={localThreshold}
            min={4000}
            max={100000}
            step={1000}
            type="single"
            onValueChange={(vals) => scheduleThresholdSave(vals)}
          />

          <ToggleGroup
            type="single"
            value={localThreshold.toString()}
            onValueChange={(val) => val && scheduleThresholdSave(parseInt(val))}
            class="flex-wrap justify-start"
          >
            {#each thresholdPresets as preset (preset.value)}
              <ToggleGroupItem value={preset.value.toString()} size="sm" class="h-7 px-2 text-xs">
                {preset.label}
              </ToggleGroupItem>
            {/each}
          </ToggleGroup>

          <p class="text-muted-foreground text-xs">
            Auto-summarization triggers when token count exceeds this threshold.
          </p>
        </div>

        <!-- Buffer Messages -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <Label for="buffer-messages" class="text-muted-foreground">Buffer Messages</Label>
            <span class="text-foreground text-sm font-medium">{localBuffer}</span>
          </div>

          <Slider
            id="buffer-messages"
            value={localBuffer}
            type="single"
            min={0}
            max={50}
            step={1}
            onValueChange={(val) => scheduleBufferSave(val)}
          />

          <p class="text-muted-foreground text-xs">
            Recent messages protected from being included in chapter summaries. Higher values keep
            more context visible but create smaller chapters.
          </p>
        </div>
      </CardContent>
    </Card>
  </div>
{/if}
