<script lang="ts">
  import { slide } from 'svelte/transition'
  import {
    Loader2,
    Check,
    Sparkles,
    X,
    PenTool,
    Wand2,
    Rocket,
    Search,
    Skull,
    Heart,
    Building,
    Archive,
    ChevronDown,
    MapPin,
  } from 'lucide-svelte'
  import UniversalVaultBrowser from '$lib/components/vault/UniversalVaultBrowser.svelte'
  import type { ExpandedSetting, GeneratedCharacter } from '$lib/services/ai/sdk'
  import type { VaultScenario } from '$lib/types'
  import { QUICK_START_SEEDS } from '$lib/services/templates'

  // Shadcn Components
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Separator } from '$lib/components/ui/separator'
  import { Badge } from '$lib/components/ui/badge'
  import * as Collapsible from '$lib/components/ui/collapsible'

  interface Props {
    settingSeed: string
    expandedSetting: ExpandedSetting | null
    settingElaborationGuidance: string
    isExpandingSetting: boolean
    isRefiningSetting: boolean
    settingError: string | null
    isEditingSetting: boolean
    selectedScenarioId: string | null
    importedCardNpcs: GeneratedCharacter[]
    cardImportError: string | null
    isImportingCard: boolean
    savedScenarioToVaultConfirm: boolean
    showScenarioVaultPicker: boolean
    customGenre: string // NEW
    onSettingSeedChange: (value: string) => void
    onGuidanceChange: (value: string) => void
    onCustomGenreChange: (value: string) => void // NEW
    onUseAsIs: () => void
    onExpandSetting: () => void
    onExpandFurther: () => void
    onEditSetting: () => void
    onCancelEdit: () => void
    onSelectScenario: (id: string) => void
    onClearCardImport: () => void
    onSaveToVault: () => void
    onShowVaultPickerChange: (show: boolean) => void
    onSelectFromVault: (scenario: VaultScenario) => void
    cardImportFileInputRef: (el: HTMLInputElement | null) => void
    scenarioCarouselRef: (el: HTMLDivElement | null) => void
    onCarouselScroll: () => void
    onNavigateToVault?: () => void
  }

  let {
    settingSeed,
    expandedSetting,
    settingElaborationGuidance,
    isExpandingSetting,
    isRefiningSetting,
    settingError,
    selectedScenarioId,
    importedCardNpcs,
    cardImportError,
    savedScenarioToVaultConfirm,
    showScenarioVaultPicker,
    customGenre,
    onSettingSeedChange,
    onGuidanceChange,
    onCustomGenreChange,
    onUseAsIs,
    onExpandSetting,
    onExpandFurther,
    onSelectScenario,
    onClearCardImport,
    onSaveToVault,
    onShowVaultPickerChange,
    onSelectFromVault,
    onNavigateToVault,
  }: Props = $props()

  const templateIcons: Record<string, typeof Wand2> = {
    'fantasy-adventure': Wand2,
    'scifi-exploration': Rocket,
    'mystery-investigation': Search,
    'horror-survival': Skull,
    'slice-of-life': Heart,
    'historical-drama': Building,
  }

  const hasUserPlaceholder = $derived(settingSeed.includes('{{user}}'))

  let showExpandOptions = $state(false)
  let loadedVaultScenarioId = $state<string | null>(null)
  let editDescription = $state('')
  let isEditingDescription = $state(false)

  function handleSelectFromVault(scenario: VaultScenario) {
    loadedVaultScenarioId = scenario.id
    onSelectFromVault(scenario)
  }

  function handleEditDescription() {
    editDescription = expandedSetting?.description ?? ''
    isEditingDescription = true
  }

  function handleSaveDescription() {
    if (editDescription.trim()) {
      onSettingSeedChange(editDescription)
      onUseAsIs()
    }
    isEditingDescription = false
  }
</script>

<div class="space-y-1 pb-3">
  <div class="flex items-center justify-between pb-1">
    <h4 class="text-muted-foreground flex items-center gap-2 text-sm font-medium">
      <Archive class="h-4 w-4" />
      Load from Vault
    </h4>
    <Button
      variant="link"
      size="sm"
      class="h-auto p-0 text-xs"
      onclick={() => onNavigateToVault?.()}
    >
      Manage Vault
    </Button>
  </div>

  <div
    class="border-muted-foreground/20 bg-muted/10 text-card-foreground rounded-lg border shadow-sm"
  >
    <Collapsible.Root open={showScenarioVaultPicker} onOpenChange={onShowVaultPickerChange}>
      <div class="flex items-center gap-3 p-3 pl-4">
        <Collapsible.Trigger
          class="group/trigger flex w-full flex-1 items-center justify-between gap-2 text-left"
        >
          <div class="flex items-center gap-3">
            <div
              class="bg-primary/10 flex h-8 w-8 items-center justify-center rounded-md transition-colors"
            >
              <MapPin class="text-primary h-4 w-4" />
            </div>
            <div class="text-left">
              <div class="text-sm font-medium">
                {selectedScenarioId && loadedVaultScenarioId
                  ? 'Scenario Selected'
                  : 'Select a Scenario'}
              </div>
              <div class="text-muted-foreground text-xs">
                {selectedScenarioId && loadedVaultScenarioId
                  ? 'Click to change selection'
                  : 'Browse your saved worlds'}
              </div>
            </div>
          </div>
          <div
            class="bg-muted/50 group-hover/trigger:bg-muted flex h-8 w-8 items-center justify-center rounded-md transition-colors"
          >
            <ChevronDown
              class="h-4 w-4 transition-transform duration-200 group-data-[state=open]/trigger:rotate-180"
            />
          </div>
        </Collapsible.Trigger>
      </div>

      <Collapsible.Content>
        <div class="h-70 border-t p-3">
          <UniversalVaultBrowser
            type="scenario"
            onSelect={handleSelectFromVault}
            selectedId={loadedVaultScenarioId}
            {onNavigateToVault}
          />
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  </div>
</div>
<h4 class="text-muted-foreground flex items-center gap-2 pb-2 text-sm font-medium">
  <MapPin class="h-4 w-4" />
  Quick Start Templates
</h4>
<div class="grid grid-cols-2 gap-2 pb-4 sm:grid-cols-3">
  {#each QUICK_START_SEEDS as seed (seed.id)}
    {@const Icon = templateIcons[seed.id] ?? Sparkles}
    <button
      onclick={() => onSelectScenario(seed.id)}
      class="group hover:bg-accent hover:text-accent-foreground relative flex items-center justify-between gap-2 rounded-lg border p-3 text-left transition-all {selectedScenarioId ===
      seed.id
        ? 'border-primary bg-primary/5 ring-primary ring-1'
        : 'bg-muted/20 hover:bg-muted/40 border-muted-foreground/20'}"
    >
      <div class="flex min-w-0 items-center gap-2">
        <Icon
          class="text-muted-foreground group-hover:text-primary h-4 w-4 shrink-0 transition-colors"
        />
        <span class="truncate text-sm leading-none font-medium">{seed.name}</span>
      </div>
      {#if selectedScenarioId === seed.id}
        <Check class="text-primary h-3 w-3 shrink-0" />
      {/if}
    </button>
  {/each}
</div>

<!-- SECTION 2: Customization (Genre & Setting) -->
<div class="grid gap-4 sm:grid-cols-1">
  <!-- Genre Input -->
  <div class="space-y-1">
    <Input
      label="Genre"
      id="genre-input"
      value={customGenre}
      oninput={(e) => onCustomGenreChange(e.currentTarget.value)}
      placeholder="e.g. Dark Fantasy, Cyberpunk Noir, etc."
    />
    <p class="text-muted-foreground text-[0.8rem]">
      A short tag describing the style/tone of your story.
    </p>
  </div>

  <!-- Setting Description -->
  <div class="space-y-2">
    <Label for="setting-input">World Description</Label>
    <Textarea
      id="setting-input"
      value={settingSeed}
      oninput={(e) => onSettingSeedChange(e.currentTarget.value)}
      placeholder="Describe your world... (e.g., A kingdom where music is magic)"
      class="mt-1 min-h-25 resize-none"
    />

    {#if hasUserPlaceholder}
      <div class="bg-muted/50 text-muted-foreground flex items-center gap-2 rounded-md p-2 text-xs">
        <Badge variant="outline" class="h-5 font-mono text-[10px]">{'{{user}}'}</Badge>
        <span>will be replaced with your character's name</span>
      </div>
    {/if}

    <div class="flex items-center justify-between gap-2 pt-1">
      <Button
        variant="outline"
        size="sm"
        class="text-muted-foreground gap-2"
        onclick={() => (showExpandOptions = !showExpandOptions)}
      >
        <Sparkles class="h-3.5 w-3.5" />
        {showExpandOptions ? 'Hide AI Options' : 'Expand with AI'}
        <ChevronDown class="h-3 w-3 transition-transform {showExpandOptions ? 'rotate-180' : ''}" />
      </Button>

      <Button size="sm" onclick={onUseAsIs} disabled={!settingSeed.trim()} class="gap-2">
        <Check class="h-3.5 w-3.5" />
        Use Description
      </Button>
    </div>

    <!-- AI Expansion Panel -->
    {#if showExpandOptions}
      <div
        class="text-card-foreground bg-muted/10 space-y-3 rounded-lg border px-3 pt-1 pb-3 shadow-sm"
        transition:slide={{ duration: 150 }}
      >
        <div class="space-y-1.5">
          <Label for="ai-guidance" class="text-xs">AI Guidance (Optional)</Label>
          <Textarea
            id="ai-guidance"
            value={settingElaborationGuidance}
            oninput={(e) => onGuidanceChange(e.currentTarget.value)}
            placeholder="e.g., Focus on dark gothic atmosphere, add steampunk elements..."
            class="mt-1 h-16 resize-none text-sm"
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          class="w-full gap-2"
          onclick={onExpandSetting}
          disabled={isExpandingSetting || !settingSeed.trim()}
        >
          {#if isExpandingSetting}
            <Loader2 class="h-3.5 w-3.5 animate-spin" />
            Expanding...
          {:else}
            <Sparkles class="h-3.5 w-3.5" />
            Generate Expanded World
          {/if}
        </Button>
      </div>
    {/if}

    {#if settingError}
      <p class="text-destructive text-sm">{settingError}</p>
    {/if}
  </div>
</div>

<!-- Card Import Status -->
{#if importedCardNpcs.length > 0}
  <div
    class="flex items-center justify-between rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm"
  >
    <span class="flex items-center gap-2 text-green-500">
      <Check class="h-4 w-4" />
      Imported NPCs: {importedCardNpcs.map((n) => n.name).join(', ')}
    </span>
    <Button
      variant="ghost"
      size="icon"
      class="text-muted-foreground hover:text-foreground h-6 w-6"
      onclick={onClearCardImport}
    >
      <X class="h-3.5 w-3.5" />
    </Button>
  </div>
{/if}
{#if cardImportError}
  <p class="text-destructive text-sm">{cardImportError}</p>
{/if}

<!-- Selected Expanded Setting Display -->
{#if expandedSetting}
  <Separator class="my-4" />
  <div
    class="bg-card text-card-foreground space-y-2 rounded-lg border p-2 shadow-sm"
    transition:slide
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Check class="h-4 w-4 text-green-500" />
        <span class="font-medium">Active World Setting</span>
      </div>

      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          class="h-8 gap-1.5 {savedScenarioToVaultConfirm
            ? 'text-green-500 hover:text-green-600'
            : 'text-muted-foreground'}"
          onclick={onSaveToVault}
          disabled={!settingSeed.trim() || savedScenarioToVaultConfirm}
        >
          {#if savedScenarioToVaultConfirm}
            <Check class="h-3.5 w-3.5" /> Saved
          {:else}
            <Archive class="h-3.5 w-3.5" /> Save
          {/if}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          class="text-muted-foreground h-8 gap-1.5"
          onclick={isEditingDescription ? handleSaveDescription : handleEditDescription}
        >
          {#if isEditingDescription}
            <Check class="h-3.5 w-3.5" /> Done
          {:else}
            <PenTool class="h-3.5 w-3.5" /> Edit
          {/if}
        </Button>
      </div>
    </div>

    <!-- Content -->
    <div class="space-y-3">
      {#if isEditingDescription}
        <Textarea
          value={editDescription}
          oninput={(e) => (editDescription = e.currentTarget.value)}
          class="min-h-37.5"
        />
      {:else}
        <div class="prose prose-sm dark:prose-invert text-muted-foreground max-w-none">
          <p class="whitespace-pre-wrap">{expandedSetting.description}</p>
        </div>
      {/if}

      <!-- Locations -->
      {#if expandedSetting.keyLocations.length > 0}
        <div class="flex flex-wrap gap-2 text-xs">
          <span class="text-foreground py-0.5 font-medium">Locations:</span>
          {#each expandedSetting.keyLocations as loc (loc.name)}
            <Badge variant="secondary" class="font-normal">{loc.name}</Badge>
          {/each}
        </div>
      {/if}

      <!-- Themes -->
      {#if expandedSetting.themes.length > 0}
        <div class="flex flex-wrap gap-1.5">
          {#each expandedSetting.themes as theme (theme)}
            <Badge variant="outline" class="text-[10px]">{theme}</Badge>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Refine -->
    <div class="flex gap-2">
      <Input
        value={settingElaborationGuidance}
        oninput={(e) => onGuidanceChange(e.currentTarget.value)}
        placeholder="Refinement notes..."
        class="h-8 text-xs"
      />
      <Button
        variant="outline"
        size="sm"
        class="h-8 w-8 p-0"
        onclick={onExpandFurther}
        disabled={isRefiningSetting}
        title="Refine with AI"
      >
        {#if isRefiningSetting}
          <Loader2 class="h-3.5 w-3.5 animate-spin" />
        {:else}
          <Sparkles class="h-3.5 w-3.5" />
        {/if}
      </Button>
    </div>
  </div>
{/if}
