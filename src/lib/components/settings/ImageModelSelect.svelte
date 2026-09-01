<script lang="ts">
  import type { ImageModelInfo } from '$lib/services/ai/image'
  import { Autocomplete } from '$lib/components/ui/autocomplete'
  import { Button } from '$lib/components/ui/button'
  import { RefreshCw, Loader2, Check, ImagePlus } from '@lucide/svelte'
  import { cn } from '$lib/utils/cn'
  import {
    DEFAULT_AVG_PROMPT_TOKENS,
    DEFAULT_AVG_IMAGE_TOKENS,
  } from '$lib/services/ai/image/constants'

  interface Props {
    models: ImageModelInfo[]
    selectedModelId: string
    onModelChange: (modelId: string) => void

    // Optional features
    showCost?: boolean
    showImg2ImgIndicator?: boolean
    showDescription?: boolean

    // Loading state
    isLoading?: boolean
    errorMessage?: string | null
    showRefreshButton?: boolean
    onRefresh?: () => void

    // Styling
    placeholder?: string
  }

  let {
    models,
    selectedModelId,
    onModelChange,
    showCost = false,
    showImg2ImgIndicator = false,
    showDescription = false,
    isLoading = false,
    errorMessage = null,
    showRefreshButton = false,
    onRefresh,
    placeholder = 'Select a model',
  }: Props = $props()

  // Format cost per image
  function formatCost(model: ImageModelInfo): string {
    if (!model.costPerImage) return ''

    const costPerTextToken = model.costPerTextToken ?? 0
    const costPerImageToken = model.costPerImageToken ?? 0

    const totalCost =
      model.costPerImage +
      costPerTextToken * DEFAULT_AVG_PROMPT_TOKENS +
      costPerImageToken * DEFAULT_AVG_IMAGE_TOKENS

    // Format cost with appropriate decimal places
    if (totalCost < 0.001) {
      return `$${totalCost.toFixed(4)}`
    } else if (totalCost < 0.01) {
      return `$${totalCost.toFixed(3)}`
    } else {
      return `$${totalCost.toFixed(2)}`
    }
  }

  // Generate label with optional cost and img2img indicator
  function getModelLabel(model: ImageModelInfo): string {
    let label = model.name

    if (showCost && model.costPerImage) {
      label += ` (${formatCost(model)})`
    }

    return label
  }

  // Get current selection object
  const selectedModel = $derived(models.find((m) => m.id === selectedModelId))

  // An id the provider does not list is reported, never offered as a choice. Silent while the
  // list is empty: nothing was fetched yet, or the fetch failed, and neither says anything
  // about the saved id.
  const selectedIsUnavailable = $derived(!!selectedModelId && models.length > 0 && !selectedModel)
  const selectedLabel = $derived(
    selectedModel ? getModelLabel(selectedModel) : selectedModelId || placeholder,
  )

  /** `undefined` is the dropdown giving us nothing; an empty string is a deliberate clear. */
  function handleChange(value: string | undefined) {
    if (value === undefined) return
    onModelChange(value.trim())
  }
</script>

<div class="w-full space-y-2">
  {#if isLoading}
    <div class="text-muted-foreground flex items-center gap-2 text-sm">
      <Loader2 class="h-4 w-4 animate-spin" />
      Loading models...
    </div>
  {:else}
    <div class="flex items-center gap-2">
      <div class="flex-1">
        <Autocomplete
          items={models}
          selected={selectedModel}
          onSelect={(m) => handleChange((m as ImageModelInfo)?.id)}
          allowCustom={true}
          onCustomSelect={(val) => handleChange(val)}
          itemLabel={(m) => m.name}
          itemValue={(m) => m.id}
          {placeholder}
        >
          {#snippet itemSnippet(model)}
            <div class="flex w-full flex-col items-start gap-1">
              <div class="flex w-full items-center justify-between gap-2">
                <div class="flex items-center gap-2 truncate">
                  <Check
                    class={cn(
                      'h-4 w-4',
                      selectedModelId === model.id ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span class="truncate">{getModelLabel(model)}</span>
                </div>
                {#if showImg2ImgIndicator && model.supportsImg2Img}
                  <ImagePlus class="text-muted-foreground h-4 w-4 shrink-0" />
                {/if}
              </div>
              {#if showDescription && model.description}
                <span class="text-muted-foreground pl-6 text-xs">
                  {model.description}
                </span>
              {/if}
            </div>
          {/snippet}
          {#snippet triggerSnippet()}
            <span class="flex w-full items-center justify-between gap-2 overflow-hidden">
              <span class="truncate">{selectedLabel}</span>
              {#if showImg2ImgIndicator && selectedModel?.supportsImg2Img}
                <ImagePlus class="text-muted-foreground h-3.5 w-3.5 shrink-0" />
              {/if}
            </span>
          {/snippet}
        </Autocomplete>
      </div>

      {#if showRefreshButton && onRefresh}
        <Button variant="ghost" size="icon" onclick={onRefresh} aria-label="Refresh models">
          <RefreshCw class="h-4 w-4" />
        </Button>
      {/if}
    </div>
    {#if selectedIsUnavailable}
      <p class="text-muted-foreground text-xs" role="status">
        "{selectedModelId}" is not in the list fetched from this provider. It will be sent as typed.
      </p>
    {/if}
    {#if errorMessage}
      <p class="text-destructive text-xs" role="alert">{errorMessage}</p>
    {/if}
  {/if}
</div>
