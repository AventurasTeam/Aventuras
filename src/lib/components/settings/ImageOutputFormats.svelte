<script lang="ts">
  import { ArrowDown, ArrowUp, Plus, X } from '@lucide/svelte'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Input } from '#lib/components/ui/input/index.ts'
  import { Label } from '#lib/components/ui/label/index.ts'
  import {
    IMAGE_OUTPUT_FORMATS,
    addImageOutput,
    moveImageOutput,
    removeImageOutput,
    setImageOutputCompression,
    takesCompression,
    type ImageOutputPreference,
  } from '#lib/utils/imageOutput.ts'

  interface Props {
    value: ImageOutputPreference[]
    onChange: (next: ImageOutputPreference[]) => void
  }

  const { value, onChange }: Props = $props()

  const addable = $derived(
    IMAGE_OUTPUT_FORMATS.filter((format) => !value.some((entry) => entry.format === format)),
  )

  function commitCompression(index: number, input: HTMLInputElement) {
    const next = setImageOutputCompression(
      value,
      index,
      input.value === '' ? undefined : Number(input.value),
    )
    onChange(next)
    // A clamped value can equal the stored one, which would leave the typed text on screen.
    input.value = String(next[index]?.compression ?? '')
  }
</script>

<div class="space-y-3">
  {#if value.length === 0}
    <p class="text-muted-foreground text-xs">
      No preference. Each provider returns its own default format.
    </p>
  {:else}
    <ol class="space-y-2">
      {#each value as entry, index (entry.format)}
        <li class="bg-background flex flex-wrap items-center gap-2 rounded-md border p-2">
          <span class="text-muted-foreground w-5 text-center text-xs tabular-nums">
            {index + 1}
          </span>
          <span class="w-12 text-sm font-medium uppercase">{entry.format}</span>
          <div class="flex min-w-0 flex-1 items-center gap-2">
            {#if takesCompression(entry.format)}
              <Label for="image-output-compression-{entry.format}" class="text-xs font-normal">
                Compression
              </Label>
              <Input
                id="image-output-compression-{entry.format}"
                type="number"
                min="0"
                max="100"
                step="1"
                placeholder="Provider default"
                value={entry.compression ?? ''}
                fullWidth={false}
                class="h-8 w-36"
                onchange={(event) => commitCompression(index, event.currentTarget)}
              />
            {:else}
              <span class="text-muted-foreground text-xs">Lossless</span>
            {/if}
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              class="size-8"
              disabled={index === 0}
              aria-label="Prefer {entry.format} more"
              title="Move up"
              onclick={() => onChange(moveImageOutput(value, index, -1))}
            >
              <ArrowUp class="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="size-8"
              disabled={index === value.length - 1}
              aria-label="Prefer {entry.format} less"
              title="Move down"
              onclick={() => onChange(moveImageOutput(value, index, 1))}
            >
              <ArrowDown class="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="size-8"
              aria-label="Remove {entry.format}"
              title="Remove"
              onclick={() => onChange(removeImageOutput(value, index))}
            >
              <X class="size-4" />
            </Button>
          </div>
        </li>
      {/each}
    </ol>
  {/if}

  {#if addable.length > 0}
    <div class="flex flex-wrap items-center gap-2">
      {#each addable as format, index (index)}
        <Button
          variant="outline"
          size="sm"
          class="uppercase"
          onclick={() => onChange(addImageOutput(value, format))}
        >
          <Plus class="size-3.5" />
          {format}
        </Button>
      {/each}
    </div>
  {/if}
</div>
