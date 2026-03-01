<script lang="ts">
  import { settings } from '$lib/stores/settings.svelte'
  import { Cpu, AlertTriangle, Brain } from 'lucide-svelte'
  import type { ReasoningEffort } from '$lib/types'
  import { cn } from '$lib/utils/cn'
  import {
    fetchModelsFromProvider,
    supportsReasoning,
    modelSupportsReasoning,
    getReasoningMode,
  } from '$lib/services/ai/sdk/providers'

  // Shadcn Components
  import * as Card from '$lib/components/ui/card'
  import { Label } from '$lib/components/ui/label'
  import { Button } from '$lib/components/ui/button'
  import { Slider } from '$lib/components/ui/slider'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import ModelSelector from './ModelSelector.svelte'

  interface Props {
    onOpenManualBodyEditor: (title: string, value: string, onSave: (next: string) => void) => void
  }

  let { onOpenManualBodyEditor }: Props = $props()

  const reasoningLevels: ReasoningEffort[] = ['off', 'low', 'medium', 'high']
  const reasoningLabels: Record<ReasoningEffort, string> = {
    off: 'Off',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  }

  let isLoadingModels = $state(false)
  let modelError = $state<string | null>(null)

  function getReasoningIndex(value?: ReasoningEffort): number {
    const index = reasoningLevels.indexOf(value ?? 'off')
    return index === -1 ? 0 : index
  }

  function getReasoningValue(index: number): ReasoningEffort {
    const clamped = Math.min(Math.max(0, index), reasoningLevels.length - 1)
    return reasoningLevels[clamped]
  }

  async function handleSetMainNarrativeProfile(profileId: string) {
    await settings.setMainNarrativeProfile(profileId)
  }

  async function fetchModelsToProfile() {
    const profile = settings.getMainNarrativeProfile()
    if (!profile) return
    if (isLoadingModels) return

    isLoadingModels = true
    modelError = null

    try {
      const result = await fetchModelsFromProvider(
        profile.providerType,
        profile.baseUrl,
        profile.apiKey,
      )

      await settings.updateProfile(profile.id, {
        ...profile,
        fetchedModels: result.models,
        reasoningModels: result.reasoningModels,
      })

      console.log(
        `[MainNarrative] Fetched ${result.models.length} models from ${profile.providerType}`,
      )
    } catch (error) {
      console.error('[MainNarrative] Failed to fetch models:', error)
      modelError = error instanceof Error ? error.message : 'Failed to load models.'
    } finally {
      isLoadingModels = false
    }
  }

  // Check if reasoning is supported for the current profile and model
  let reasoningSupported = $derived.by(() => {
    const profile = settings.getMainNarrativeProfile()
    if (!profile) return false

    // Check if provider supports reasoning
    if (!supportsReasoning(profile.providerType)) return false

    // Check if the specific model supports reasoning
    const model = settings.apiSettings.defaultModel
    if (!model) return false

    return modelSupportsReasoning(model, profile.providerType, profile.reasoningModels)
  })

  // For 'fetched' providers (e.g., NanoGPT), reasoning is binary — no slider, just text
  let isFetchedReasoningProvider = $derived.by(() => {
    const profile = settings.getMainNarrativeProfile()
    if (!profile) return false
    return getReasoningMode(profile.providerType) === 'fetched'
  })

  // For 'heuristic' providers (e.g., Ollama), reasoning is tag-based only — no effort levels
  let isHeuristicReasoningProvider = $derived.by(() => {
    const profile = settings.getMainNarrativeProfile()
    if (!profile) return false
    return getReasoningMode(profile.providerType) === 'heuristic'
  })

  // Proxy states for sliders to ensure correct array type binding
  let tempValue = $derived(settings.apiSettings.temperature)
  let tokensValue = $derived(settings.apiSettings.maxTokens)
  let reasoningValue = $derived(getReasoningIndex(settings.apiSettings.reasoningEffort))

  function updateTemperature(v: number) {
    settings.setTemperature(v)
  }

  function updateTokens(v: number) {
    settings.setMaxTokens(v)
  }

  function updateReasoning(v: number) {
    settings.setMainReasoningEffort(getReasoningValue(v))
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="flex items-center gap-2 text-base">
      <Cpu class="text-primary h-5 w-5" />
      Main Narrative
    </Card.Title>
  </Card.Header>

  <Card.Content class="grid gap-3 pt-4">
    {#if settings.apiSettings.profiles.length === 0}
      <div
        class="flex items-center gap-2 rounded border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400"
      >
        <AlertTriangle class="h-4 w-4 shrink-0" />
        No API profiles configured. Add one in the API tab.
      </div>
    {:else if !settings.apiSettings.defaultModel}
      <div
        class="text-muted-foreground bg-muted/50 flex items-center gap-2 rounded border border-dashed px-3 py-2 text-sm"
      >
        <AlertTriangle class="h-4 w-4 shrink-0" />
        No model selected. Choose a model below or set one from the API tab.
      </div>
    {/if}
    <div class="grid gap-2">
      <ModelSelector
        class="grid-cols-1 md:grid-cols-2"
        profileId={settings.apiSettings.mainNarrativeProfileId}
        model={settings.apiSettings.defaultModel}
        onProfileChange={(id) => handleSetMainNarrativeProfile(id || '')}
        onModelChange={(m) => settings.setDefaultModel(m)}
        onRefreshModels={fetchModelsToProfile}
        isRefreshingModels={isLoadingModels}
      />
      {#if modelError}
        <p class="text-destructive text-xs">{modelError}</p>
      {/if}
      {#if isFetchedReasoningProvider}
        {#if reasoningSupported}
          <div class="flex items-center gap-1.5 text-xs text-emerald-500">
            <Brain class="h-3.5 w-3.5" />
            Reasoning enabled
          </div>
        {:else}
          <p class="text-muted-foreground text-xs">
            Some models support reasoning. Fetch models to detect capabilities.
          </p>
        {/if}
      {/if}
    </div>

    <!-- Temperature & Max Tokens Row -->
    <div
      class={cn(
        'grid grid-cols-1 gap-6 border-t pt-4 md:grid-cols-2',
        settings.advancedRequestSettings.manualMode && 'pointer-events-none opacity-50',
      )}
    >
      <div class="grid gap-4">
        <div class="flex justify-between">
          <Label>Temperature</Label>
          <span class="text-muted-foreground text-xs"
            >{settings.apiSettings.temperature.toFixed(1)}</span
          >
        </div>
        <Slider
          bind:value={tempValue}
          type="single"
          min={0}
          max={2}
          step={0.1}
          onValueChange={updateTemperature}
        />
        <div class="text-muted-foreground flex justify-between text-xs">
          <span>Focused</span>
          <span>Creative</span>
        </div>
      </div>

      <div class="grid gap-4">
        <div class="flex items-center justify-between">
          <Label>Max Tokens</Label>
        </div>
        <div class="flex items-start justify-start gap-4 pt-0.5">
          <div class="flex flex-1 flex-col gap-4.5">
            <Slider
              bind:value={tokensValue}
              type="single"
              min={1024}
              max={128000}
              step={1024}
              onValueChange={updateTokens}
            />
            <div class="text-muted-foreground flex justify-between text-xs">
              <span>1K</span>
              <span>128K</span>
            </div>
          </div>
          <div class="-mt-5.5">
            <Input
              type="number"
              class="h-8 w-24 text-left"
              value={settings.apiSettings.maxTokens}
              oninput={(e) => {
                const value = parseInt(e.currentTarget.value)
                if (!isNaN(value)) {
                  settings.setMaxTokens(value)
                }
              }}
              onchange={(e) => {
                const value = parseInt(e.currentTarget.value)
                if (value < 1024) settings.setMaxTokens(1024)
                if (value > 128000) settings.setMaxTokens(128000)
              }}
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Thinking Row (only shown if provider/model supports native reasoning slider) -->
    {#if reasoningSupported && !isFetchedReasoningProvider && !isHeuristicReasoningProvider}
      <div
        class={cn(
          'grid grid-cols-1 gap-6 border-t pt-4 md:grid-cols-2',
          settings.advancedRequestSettings.manualMode && 'pointer-events-none opacity-50',
        )}
      >
        <div class="grid gap-4">
          <div class="flex justify-between">
            <Label>Thinking: {reasoningLabels[settings.apiSettings.reasoningEffort]}</Label>
          </div>
          <Slider
            bind:value={reasoningValue}
            type="single"
            min={0}
            max={3}
            step={1}
            onValueChange={updateReasoning}
          />
          <div class="text-muted-foreground flex justify-between text-xs">
            <span>Off</span>
            <span>Low</span>
            <span>Med</span>
            <span>High</span>
          </div>
        </div>
      </div>
    {/if}

    {#if settings.advancedRequestSettings.manualMode}
      <div class="mt-4 border-t pt-4">
        <div class="mb-2 flex items-center justify-between">
          <Label>Manual Request Body (JSON)</Label>
          <Button
            variant="text"
            size="sm"
            class="h-auto p-0"
            onclick={() =>
              onOpenManualBodyEditor('Main Narrative', settings.apiSettings.manualBody, (next) => {
                settings.apiSettings.manualBody = next
                settings.setMainManualBody(next)
              })}
          >
            Pop out
          </Button>
        </div>
        <Textarea
          bind:value={settings.apiSettings.manualBody}
          onblur={() => settings.setMainManualBody(settings.apiSettings.manualBody)}
          class="min-h-[100px] w-full resize-y font-mono"
          rows={4}
        />
        <p class="text-muted-foreground mt-1 text-xs">
          Overrides request parameters; messages and tools are managed by Aventuras.
        </p>
      </div>
    {/if}
  </Card.Content>
</Card.Root>
