<script lang="ts">
  import {
    groupLoadFailures,
    LOADED_LIST_LABELS,
    sortLoadFailures,
    type ImageModelInfo,
    type LoadFailure,
  } from '#lib/services/ai/image/index.ts'
  import { Autocomplete } from '#lib/components/ui/autocomplete/index.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import * as Collapsible from '#lib/components/ui/collapsible/index.ts'
  import { RefreshCw, Loader2, Check, ImagePlus, Square, ChevronRight } from '@lucide/svelte'
  import { cn } from '#lib/utils/cn.ts'

  interface Props {
    models: ImageModelInfo[]
    selectedModelId: string
    onModelChange: (modelId: string) => void

    // Optional features
    showImg2ImgIndicator?: boolean
    showDescription?: boolean

    // Loading state
    isLoading?: boolean
    failures?: LoadFailure[]
    // Prefix each failure line with the lists it covers, for providers that load several.
    labelLists?: boolean
    showRefreshButton?: boolean
    onRefresh?: () => void
    onStop?: () => void

    // Styling
    placeholder?: string
  }

  let {
    models,
    selectedModelId,
    onModelChange,
    showImg2ImgIndicator = false,
    showDescription = false,
    isLoading = false,
    failures = [],
    labelLists = false,
    showRefreshButton = false,
    onRefresh,
    onStop,
    placeholder = 'Select a model',
  }: Props = $props()

  const orderedFailures = $derived(sortLoadFailures(failures))
  const failureLines = $derived(
    groupLoadFailures(orderedFailures).map(({ lists, summary }) =>
      labelLists ? `${lists.map((l) => LOADED_LIST_LABELS[l]).join(', ')}: ${summary}` : summary,
    ),
  )
  const detailsText = $derived(
    orderedFailures
      .map(({ list, detail }) => (labelLists ? `${LOADED_LIST_LABELS[list]}\n${detail}` : detail))
      .join('\n\n'),
  )
  const hasDetails = $derived(
    orderedFailures.some(({ summary, detail }) => detail.trim() !== summary) ||
      orderedFailures.length > 1,
  )

  let copied = $state(false)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  async function copyDetails() {
    if (!detailsText) return
    try {
      await navigator.clipboard.writeText(detailsText)
      copied = true
      clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => (copied = false), 1500)
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
    }
  }

  $effect(() => () => clearTimeout(copiedTimer))

  // Get current selection object
  const selectedModel = $derived(models.find((m) => m.id === selectedModelId))

  // An id the provider does not list is reported, never offered as a choice. Silent while the
  // list is empty: nothing was fetched yet, or the fetch failed, and neither says anything
  // about the saved id.
  const selectedIsUnavailable = $derived(!!selectedModelId && models.length > 0 && !selectedModel)
  const selectedLabel = $derived(
    selectedModel ? selectedModel.name : selectedModelId || placeholder,
  )

  /** `undefined` is the dropdown giving us nothing; an empty string is a deliberate clear. */
  function handleChange(value: string | undefined) {
    if (value === undefined) return
    onModelChange(value.trim())
  }
</script>

<div class="w-full space-y-2">
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
                  class={cn('h-4 w-4', selectedModelId === model.id ? 'opacity-100' : 'opacity-0')}
                />
                <span class="truncate">{model.name}</span>
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
      {#if isLoading && onStop}
        <Button variant="ghost" size="icon" onclick={onStop} aria-label="Stop loading models">
          <span class="relative size-4">
            <Loader2 class="size-4 motion-safe:animate-spin" />
            <Square class="absolute inset-0 m-auto size-2 fill-current" />
          </span>
        </Button>
      {:else}
        <Button
          variant="ghost"
          size="icon"
          onclick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh models"
        >
          <RefreshCw class="h-4 w-4" />
        </Button>
      {/if}
    {/if}
  </div>
  {#if isLoading}
    <p class="text-muted-foreground flex items-center gap-2 text-xs" role="status">
      <Loader2 class="size-3.5 motion-safe:animate-spin" />
      Loading models…
    </p>
  {/if}
  {#if selectedIsUnavailable}
    <p class="text-muted-foreground text-xs" role="status">
      "{selectedModelId}" is not in the list fetched from this provider. It will be sent as typed.
    </p>
  {/if}
  {#each failureLines as line, i (i)}
    <p class="text-destructive text-xs" role="alert">{line}</p>
  {/each}
  {#if hasDetails}
    <Collapsible.Root>
      <Collapsible.Trigger
        class="group/details text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
      >
        <ChevronRight
          class="size-3 transition-transform duration-200 group-data-[state=open]/details:rotate-90"
        />
        Details
      </Collapsible.Trigger>
      <Collapsible.Content class="space-y-2 pt-1">
        {#each orderedFailures as failure (failure.list)}
          <div class="space-y-1">
            {#if labelLists}
              <p class="text-muted-foreground text-xs font-medium">
                {LOADED_LIST_LABELS[failure.list]}
              </p>
            {/if}
            <pre
              class="bg-muted max-h-48 overflow-auto rounded-md p-2 text-xs break-all whitespace-pre-wrap">{failure.detail}</pre>
          </div>
        {/each}
        <Button variant="outline" size="sm" onclick={copyDetails}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </Collapsible.Content>
    </Collapsible.Root>
  {/if}
</div>
