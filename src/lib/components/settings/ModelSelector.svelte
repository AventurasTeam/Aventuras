<script lang="ts">
  import { settings } from '$lib/stores/settings.svelte'
  import { Server, Check, RefreshCw, Star, AlertTriangle, Brain, Braces } from 'lucide-svelte'
  import Autocomplete from '$lib/components/ui/autocomplete/Autocomplete.svelte'
  import * as Select from '$lib/components/ui/select'
  import { Button } from '$lib/components/ui/button'
  import { Label } from '$lib/components/ui/label'
  import { cn } from '$lib/utils/cn'

  interface Props {
    profileId: string | null
    model: string
    onProfileChange: (profileId: string | null) => void
    onModelChange: (model: string) => void
    showProfileSelector?: boolean
    onManageProfiles?: () => void
    label?: string
    placeholder?: string
    class?: string
    onRefreshModels?: () => void
    isRefreshingModels?: boolean
  }

  let {
    profileId,
    model,
    onProfileChange,
    onModelChange,
    showProfileSelector = true,
    onManageProfiles,
    label = 'Model',
    placeholder = 'Select or type model...',
    class: className,
    onRefreshModels,
    isRefreshingModels = false,
  }: Props = $props()

  // Resolve the effective profile ID (with fallback to default)
  let effectiveProfileId = $derived(profileId || settings.getDefaultProfileIdForProvider())

  // Get available models for the selected profile (excluding hidden, favorites first)
  let availableModels = $derived(settings.getAvailableModels(effectiveProfileId))

  // Number of favorite models (for separator)
  let favoriteCount = $derived.by(() => {
    if (!effectiveProfileId) return 0
    const profile = settings.getProfile(effectiveProfileId)
    if (!profile) return 0
    const favSet = new Set(profile.favoriteModels ?? [])
    return availableModels.filter((m) => favSet.has(m.id)).length
  })

  // Check if currently selected model is missing from the profile
  let isModelMissing = $derived(
    model.length > 0 && availableModels.length > 0 && !availableModels.find((m) => m.id === model),
  )

  // Get selected profile name
  let selectedProfileName = $derived.by(() => {
    if (!profileId) return 'Select Profile'
    const profile = settings.getProfile(profileId)
    return profile?.name || 'Unknown'
  })

  // Create framework options for Select
  let profileOptions = $derived(
    settings.apiSettings.profiles.map((p) => ({
      value: p.id,
      label: p.name + (settings.apiSettings.defaultProfileId === p.id ? ' (Default)' : ''),
    })),
  )

  function checkModelReasoningCapability(modelId: string): boolean {
    const model = availableModels.find((m) => m.id === modelId)
    return !!model?.reasoning
  }

  function checkModelStructuredCapability(modelId: string): boolean {
    const model = availableModels.find((m) => m.id === modelId)
    return !!model?.structuredOutput
  }

  function handleSelectProfile(val: string) {
    onProfileChange(val)
  }

  function handleSelectModel(modelName: string) {
    onModelChange(modelName)
  }
</script>

<div class={cn('grid gap-4', className)}>
  {#if showProfileSelector}
    <div class="grid gap-2">
      <div class="flex h-4 items-center"><Label>API Profile</Label></div>
      <div class="flex gap-2">
        <Select.Root
          type="single"
          value={profileId || settings.getDefaultProfileIdForProvider()}
          onValueChange={handleSelectProfile}
        >
          <Select.Trigger class="w-full">
            {selectedProfileName}
          </Select.Trigger>
          <Select.Content>
            {#each profileOptions as option, i (i)}
              <Select.Item value={option.value}>{option.label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
        {#if onManageProfiles}
          <Button
            variant="outline"
            size="icon"
            onclick={onManageProfiles}
            title="Manage API Profiles"
            class="shrink-0"
          >
            <Server class="h-4 w-4" />
          </Button>
        {/if}
      </div>
    </div>
  {/if}

  <div class="grid gap-2">
    <div class="flex h-4 items-center justify-between">
      <Label>{label}</Label>
      <div class="flex items-center gap-2">
        {#if isModelMissing}
          <span class="hidden text-[0.7rem] text-yellow-500 md:inline">Not in profile list</span>
        {:else if availableModels.length === 0}
          <span class="text-muted-foreground hidden text-[0.7rem] md:inline"
            >No models available</span
          >
        {/if}
        {#if onRefreshModels}
          <Button
            variant="text"
            size="sm"
            class="text-muted-foreground hover:text-primary h-auto p-0 text-xs no-underline"
            onclick={onRefreshModels}
            disabled={isRefreshingModels}
          >
            <RefreshCw class={cn('mr-1 h-3 w-3', isRefreshingModels && 'animate-spin')} />
            Refresh
          </Button>
        {/if}
      </div>
    </div>
    <Autocomplete
      items={availableModels.map((m) => m.id)}
      selected={model}
      onSelect={(m) => onModelChange(m as string)}
      itemLabel={(m) => m}
      itemValue={(m) => m}
      allowCustom={true}
      onCustomSelect={handleSelectModel}
      {placeholder}
      class={cn(isModelMissing && 'border-yellow-500/50')}
      virtualized
    >
      {#snippet itemSnippet(modelOption, modelIndex)}
        {#if modelIndex < favoriteCount}
          <Star class="mr-2 h-3 w-3 text-yellow-500" />
        {:else}
          <Check class={cn('mr-2 h-4 w-4', model === modelOption ? 'opacity-100' : 'opacity-0')} />
        {/if}
        <span class="truncate">{modelOption}</span>
        {#if checkModelReasoningCapability(modelOption) || checkModelStructuredCapability(modelOption)}
          <span class="ml-auto flex shrink-0 items-center gap-1">
            {#if checkModelStructuredCapability(modelOption)}
              <Braces class="h-3 w-3 text-blue-400" />
            {/if}
            {#if checkModelReasoningCapability(modelOption)}
              <Brain class="h-3 w-3 text-emerald-500" />
            {/if}
          </span>
        {/if}
      {/snippet}
      {#snippet triggerSnippet()}
        <span class="flex items-center gap-1.5 truncate">
          {#if isModelMissing}
            <AlertTriangle class="h-3.5 w-3.5 shrink-0 text-yellow-500" />
          {/if}
          <span class="truncate">{model || placeholder}</span>
        </span>
      {/snippet}
    </Autocomplete>
    {#if isModelMissing}
      <p class="mt-1 text-[0.8rem] text-yellow-500 md:hidden">
        Model not found in this profile's model list.
      </p>
    {:else if availableModels.length === 0}
      <p class="text-muted-foreground mt-1 text-[0.8rem] md:hidden">
        No models available. Add models to the profile.
      </p>
    {/if}
  </div>
</div>
