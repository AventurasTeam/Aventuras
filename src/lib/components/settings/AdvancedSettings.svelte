<script lang="ts">
  import { settings } from '$lib/stores/settings.svelte'
  import {
    ChevronDown,
    RotateCcw,
    FolderOpen,
    BookOpen,
    Brain,
    Search,
    Bug,
    Code2,
    Layers,
    ListTree,
    Sparkles,
  } from 'lucide-svelte'
  import { Switch } from '$lib/components/ui/switch'
  import { Label } from '$lib/components/ui/label'
  import { Button } from '$lib/components/ui/button'
  import { Slider } from '$lib/components/ui/slider'
  import * as Collapsible from '$lib/components/ui/collapsible'
  import { Separator } from '$lib/components/ui/separator'

  // Section visibility state
  let showLorebookImportSection = $state(false)
  let showLoreManagementSection = $state(false)
  let showClassifierSection = $state(false)
  let showEntryRetrievalSection = $state(false)
  let showContextWindowSection = $state(false)
  let showLorebookLimitsSection = $state(false)
  let showAgenticRetrievalSection = $state(false)

  // Manual mode toggle handler
  async function handleManualModeToggle(checked: boolean) {
    await settings.setAdvancedManualMode(checked)
  }

  // Debug mode toggle handler
  function handleDebugModeToggle(checked: boolean) {
    settings.setDebugMode(checked)
  }
</script>

<div class="space-y-6">
  <!-- General Settings -->
  <div class="space-y-4">
    <!-- Manual Request Mode -->
    <div class="flex flex-row items-center justify-between">
      <div class="space-y-0.5">
        <div class="flex items-center gap-2">
          <Code2 class="text-muted-foreground h-4 w-4" />
          <Label>Manual Request Mode</Label>
        </div>
        <p class="text-muted-foreground text-xs">
          Edit full request body parameters for advanced models.
        </p>
        {#if settings.advancedRequestSettings.manualMode}
          <p class="pt-1 text-xs font-medium text-amber-500">
            Manual mode active. Temperature and max token controls are locked.
          </p>
        {/if}
      </div>
      <Switch
        checked={settings.advancedRequestSettings.manualMode}
        onCheckedChange={handleManualModeToggle}
      />
    </div>

    <!-- Debug Mode -->
    <div class="flex flex-row items-center justify-between">
      <div class="space-y-0.5">
        <div class="flex items-center gap-2">
          <Bug class="text-muted-foreground h-4 w-4" />
          <Label>Debug Mode</Label>
        </div>
        <p class="text-muted-foreground text-xs">Log API requests and responses for debugging.</p>
        {#if settings.uiSettings.debugMode}
          <p class="pt-1 text-xs font-medium text-amber-500">
            Logs are session-only and not persisted.
          </p>
        {/if}
      </div>
      <Switch checked={settings.uiSettings.debugMode} onCheckedChange={handleDebugModeToggle} />
    </div>
  </div>

  <Separator />

  <!-- Service Configurations -->
  <div class="space-y-3">
    <!-- Lorebook Import Settings -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={showLorebookImportSection}>
        <div class="flex items-center gap-3 p-3 pl-4">
          <Collapsible.Trigger class="group/trigger flex flex-1 items-center gap-2 text-left">
            <div
              class="flex h-8 w-8 items-center justify-center rounded-md bg-green-500/10 transition-colors group-hover/trigger:bg-green-500/20"
            >
              <FolderOpen class="h-4 w-4 text-green-500" />
            </div>
            <div class="flex-1">
              <Label class="leading-none font-medium">Lorebook Import</Label>
              <p class="text-muted-foreground mt-1 text-xs">Batch size and concurrency</p>
            </div>
          </Collapsible.Trigger>
          <div class="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              onclick={() => settings.resetLorebookClassifierSpecificSettings()}
              title="Reset to default"
            >
              <RotateCcw class="h-3.5 w-3.5" />
            </Button>
            <Collapsible.Trigger>
              {#snippet child({ props })}
                <Button {...props} variant="ghost" size="icon" class="h-8 w-8">
                  {#if showLorebookImportSection}
                    <ChevronDown class="h-4 w-4 rotate-180 transition-transform duration-200" />
                  {:else}
                    <ChevronDown class="h-4 w-4 transition-transform duration-200" />
                  {/if}
                  <span class="sr-only">Toggle</span>
                </Button>
              {/snippet}
            </Collapsible.Trigger>
          </div>
        </div>

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            <!-- Batch Size -->
            <div class="space-y-3">
              <div class="flex justify-between">
                <Label>Batch Size</Label>
                <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                  {settings.serviceSpecificSettings.lorebookClassifier?.batchSize ?? 50}
                </span>
              </div>
              <Slider
                value={settings.serviceSpecificSettings.lorebookClassifier?.batchSize ?? 50}
                min={10}
                max={100}
                step={10}
                type="single"
                onValueChange={(v) => {
                  settings.serviceSpecificSettings.lorebookClassifier.batchSize = v
                  settings.saveServiceSpecificSettings()
                }}
              />
              <div
                class="text-muted-foreground flex justify-between text-[10px] font-medium tracking-wider uppercase"
              >
                <span>Reliable</span>
                <span>Fast</span>
              </div>
            </div>

            <!-- Max Concurrent -->
            <div class="space-y-3">
              <div class="flex justify-between">
                <Label>Max Concurrent Requests</Label>
                <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                  {settings.serviceSpecificSettings.lorebookClassifier?.maxConcurrent ?? 5}
                </span>
              </div>
              <Slider
                value={settings.serviceSpecificSettings.lorebookClassifier?.maxConcurrent ?? 5}
                min={1}
                max={10}
                step={1}
                type="single"
                onValueChange={(v) => {
                  settings.serviceSpecificSettings.lorebookClassifier.maxConcurrent = v
                  settings.saveServiceSpecificSettings()
                }}
              />
              <div
                class="text-muted-foreground flex justify-between text-[10px] font-medium tracking-wider uppercase"
              >
                <span>Sequential</span>
                <span>Parallel</span>
              </div>
            </div>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>

    <!-- Lore Management Settings -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={showLoreManagementSection}>
        <div class="flex items-center gap-3 p-3 pl-4">
          <Collapsible.Trigger class="group/trigger flex flex-1 items-center gap-2 text-left">
            <div
              class="flex h-8 w-8 items-center justify-center rounded-md bg-purple-500/10 transition-colors group-hover/trigger:bg-purple-500/20"
            >
              <BookOpen class="h-4 w-4 text-purple-500" />
            </div>
            <div class="flex-1">
              <Label class="leading-none font-medium">Lore Management</Label>
              <p class="text-muted-foreground mt-1 text-xs">Autonomous agent iteration limits</p>
            </div>
          </Collapsible.Trigger>
          <div class="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              onclick={() => settings.resetLoreManagementSettings()}
              title="Reset to default"
            >
              <RotateCcw class="h-3.5 w-3.5" />
            </Button>
            <Collapsible.Trigger>
              {#snippet child({ props })}
                <Button {...props} variant="ghost" size="icon" class="h-8 w-8">
                  {#if showLoreManagementSection}
                    <ChevronDown class="h-4 w-4 rotate-180 transition-transform duration-200" />
                  {:else}
                    <ChevronDown class="h-4 w-4 transition-transform duration-200" />
                  {/if}
                  <span class="sr-only">Toggle</span>
                </Button>
              {/snippet}
            </Collapsible.Trigger>
          </div>
        </div>

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            <!-- Max Iterations -->
            <div class="space-y-3">
              <div class="flex justify-between">
                <Label>Max Iterations</Label>
                <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                  {settings.systemServicesSettings.loreManagement?.maxIterations ?? 50}
                </span>
              </div>
              <Slider
                value={settings.systemServicesSettings.loreManagement?.maxIterations ?? 50}
                min={10}
                max={100}
                step={5}
                type="single"
                onValueChange={(v) => {
                  settings.systemServicesSettings.loreManagement.maxIterations = v
                  settings.saveSystemServicesSettings()
                }}
              />
              <div
                class="text-muted-foreground flex justify-between text-[10px] font-medium tracking-wider uppercase"
              >
                <span>Conservative</span>
                <span>Extensive</span>
              </div>
            </div>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>

    <!-- Classifier Settings -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={showClassifierSection}>
        <div class="flex items-center gap-3 p-3 pl-4">
          <Collapsible.Trigger class="group/trigger flex flex-1 items-center gap-2 text-left">
            <div
              class="flex h-8 w-8 items-center justify-center rounded-md bg-cyan-500/10 transition-colors group-hover/trigger:bg-cyan-500/20"
            >
              <Brain class="h-4 w-4 text-cyan-500" />
            </div>
            <div class="flex-1">
              <Label class="leading-none font-medium">World State Classifier</Label>
              <p class="text-muted-foreground mt-1 text-xs">Context window management</p>
            </div>
          </Collapsible.Trigger>
          <div class="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              onclick={() => settings.resetClassifierSettings()}
              title="Reset to default"
            >
              <RotateCcw class="h-3.5 w-3.5" />
            </Button>
            <Collapsible.Trigger>
              {#snippet child({ props })}
                <Button {...props} variant="ghost" size="icon" class="h-8 w-8">
                  {#if showClassifierSection}
                    <ChevronDown class="h-4 w-4 rotate-180 transition-transform duration-200" />
                  {:else}
                    <ChevronDown class="h-4 w-4 transition-transform duration-200" />
                  {/if}
                  <span class="sr-only">Toggle</span>
                </Button>
              {/snippet}
            </Collapsible.Trigger>
          </div>
        </div>

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            <!-- Chat History Truncation -->
            <div class="space-y-3">
              <div class="flex justify-between">
                <Label>Chat History Truncation (Words)</Label>
                <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                  {settings.systemServicesSettings.classifier?.chatHistoryTruncation === 0
                    ? 'No Limit'
                    : (settings.systemServicesSettings.classifier?.chatHistoryTruncation ?? 0)}
                </span>
              </div>
              <Slider
                value={settings.systemServicesSettings.classifier?.chatHistoryTruncation ?? 0}
                min={0}
                max={500}
                step={50}
                type="single"
                onValueChange={(v) => {
                  settings.systemServicesSettings.classifier.chatHistoryTruncation = v
                  settings.saveSystemServicesSettings()
                }}
              />
              <div
                class="text-muted-foreground flex justify-between text-[10px] font-medium tracking-wider uppercase"
              >
                <span>Unlimited</span>
                <span>500 Words</span>
              </div>
            </div>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>

    <!-- Entry Retrieval Settings -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={showEntryRetrievalSection}>
        <div class="flex items-center gap-3 p-3 pl-4">
          <Collapsible.Trigger class="group/trigger flex flex-1 items-center gap-2 text-left">
            <div
              class="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/10 transition-colors group-hover/trigger:bg-amber-500/20"
            >
              <Search class="h-4 w-4 text-amber-500" />
            </div>
            <div class="flex-1">
              <Label class="leading-none font-medium">Entry Retrieval</Label>
              <p class="text-muted-foreground mt-1 text-xs">LLM-based selection settings</p>
            </div>
          </Collapsible.Trigger>
          <div class="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              onclick={() => settings.resetEntryRetrievalSettings()}
              title="Reset to default"
            >
              <RotateCcw class="h-3.5 w-3.5" />
            </Button>
            <Collapsible.Trigger>
              {#snippet child({ props })}
                <Button {...props} variant="ghost" size="icon" class="h-8 w-8">
                  {#if showEntryRetrievalSection}
                    <ChevronDown class="h-4 w-4 rotate-180 transition-transform duration-200" />
                  {:else}
                    <ChevronDown class="h-4 w-4 transition-transform duration-200" />
                  {/if}
                  <span class="sr-only">Toggle</span>
                </Button>
              {/snippet}
            </Collapsible.Trigger>
          </div>
        </div>

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            <!-- Enable LLM Selection -->
            <div class="flex flex-row items-center justify-between">
              <div class="space-y-0.5">
                <Label class="text-sm">Enable LLM Selection</Label>
                <p class="text-muted-foreground text-xs">
                  Use LLM to intelligently select lorebook entries
                </p>
              </div>
              <Switch
                checked={settings.systemServicesSettings.entryRetrieval?.enableLLMSelection ?? true}
                onCheckedChange={(v) => {
                  settings.systemServicesSettings.entryRetrieval.enableLLMSelection = v
                  settings.saveSystemServicesSettings()
                }}
              />
            </div>

            <!-- Max Tier 3 Entries -->
            <div class="space-y-3">
              <div class="flex justify-between">
                <Label>Max Tier 3 Entries</Label>
                <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                  {settings.systemServicesSettings.entryRetrieval?.maxTier3Entries === 0
                    ? 'Unlimited'
                    : (settings.systemServicesSettings.entryRetrieval?.maxTier3Entries ?? 0)}
                </span>
              </div>
              <Slider
                value={settings.systemServicesSettings.entryRetrieval?.maxTier3Entries ?? 0}
                min={0}
                max={20}
                step={1}
                type="single"
                onValueChange={(v) => {
                  settings.systemServicesSettings.entryRetrieval.maxTier3Entries = v
                  settings.saveSystemServicesSettings()
                }}
              />
              <div
                class="text-muted-foreground flex justify-between text-[10px] font-medium tracking-wider uppercase"
              >
                <span>Unlimited</span>
                <span>20 Entries</span>
              </div>
            </div>

            <!-- Max Words Per Entry -->
            <div class="space-y-3">
              <div class="flex justify-between">
                <Label>Max Words Per Entry</Label>
                <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                  {settings.systemServicesSettings.entryRetrieval?.maxWordsPerEntry === 0
                    ? 'Unlimited'
                    : (settings.systemServicesSettings.entryRetrieval?.maxWordsPerEntry ?? 0)}
                </span>
              </div>
              <Slider
                value={settings.systemServicesSettings.entryRetrieval?.maxWordsPerEntry ?? 0}
                min={0}
                max={1000}
                step={50}
                type="single"
                onValueChange={(v) => {
                  settings.systemServicesSettings.entryRetrieval.maxWordsPerEntry = v
                  settings.saveSystemServicesSettings()
                }}
              />
              <div
                class="text-muted-foreground flex justify-between text-[10px] font-medium tracking-wider uppercase"
              >
                <span>Unlimited</span>
                <span>1000 Words</span>
              </div>
            </div>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>

    <!-- Memory Retrieval Settings -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={showAgenticRetrievalSection}>
        <div class="flex items-center gap-3 p-3 pl-4">
          <Collapsible.Trigger class="group/trigger flex flex-1 items-center gap-2 text-left">
            <div
              class="flex h-8 w-8 items-center justify-center rounded-md bg-pink-500/10 transition-colors group-hover/trigger:bg-pink-500/20"
            >
              <Sparkles class="h-4 w-4 text-pink-500" />
            </div>
            <div class="flex-1">
              <Label class="leading-none font-medium">Memory Retrieval</Label>
              <p class="text-muted-foreground mt-1 text-xs">
                How past chapters are retrieved for context
              </p>
            </div>
          </Collapsible.Trigger>
          <div class="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              onclick={() => {
                settings.resetTimelineFillSettings()
                settings.resetAgenticRetrievalSpecificSettings()
              }}
              title="Reset to default"
            >
              <RotateCcw class="h-3.5 w-3.5" />
            </Button>
            <Collapsible.Trigger>
              {#snippet child({ props })}
                <Button {...props} variant="ghost" size="icon" class="h-8 w-8">
                  {#if showAgenticRetrievalSection}
                    <ChevronDown class="h-4 w-4 rotate-180 transition-transform duration-200" />
                  {:else}
                    <ChevronDown class="h-4 w-4 transition-transform duration-200" />
                  {/if}
                  <span class="sr-only">Toggle</span>
                </Button>
              {/snippet}
            </Collapsible.Trigger>
          </div>
        </div>

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            <!-- Enable Memory Retrieval -->
            <div class="flex flex-row items-center justify-between">
              <div class="space-y-0.5">
                <Label class="text-sm">Enable Memory Retrieval</Label>
                <p class="text-muted-foreground text-xs">
                  Retrieve context from past chapters during generation
                </p>
              </div>
              <Switch
                checked={settings.systemServicesSettings.timelineFill?.enabled ?? true}
                onCheckedChange={(v) => {
                  settings.systemServicesSettings.timelineFill.enabled = v
                  settings.saveSystemServicesSettings()
                }}
              />
            </div>

            {#if settings.systemServicesSettings.timelineFill?.enabled}
              <!-- Mode Selection -->
              <div class="space-y-3">
                <Label>Retrieval Mode</Label>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    class="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors {settings
                      .systemServicesSettings.timelineFill?.mode === 'static' ||
                    !settings.systemServicesSettings.timelineFill?.mode
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'}"
                    onclick={() => {
                      settings.systemServicesSettings.timelineFill.mode = 'static'
                      settings.saveSystemServicesSettings()
                    }}
                  >
                    <span class="text-sm font-medium">Static</span>
                    <span class="text-muted-foreground text-xs">
                      Generates questions, then answers them from chapters
                    </span>
                  </button>
                  <button
                    class="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors {settings
                      .systemServicesSettings.timelineFill?.mode === 'agentic'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'}"
                    onclick={() => {
                      settings.systemServicesSettings.timelineFill.mode = 'agentic'
                      settings.saveSystemServicesSettings()
                    }}
                  >
                    <span class="text-sm font-medium">Agentic</span>
                    <span class="text-muted-foreground text-xs">
                      LLM agent explores chapters and entries with tools
                    </span>
                  </button>
                </div>
              </div>

              <!-- Static Mode Options -->
              {#if settings.systemServicesSettings.timelineFill?.mode === 'static' || !settings.systemServicesSettings.timelineFill?.mode}
                <div class="space-y-3">
                  <div class="flex justify-between">
                    <Label>Max Queries</Label>
                    <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                      {settings.systemServicesSettings.timelineFill?.maxQueries ?? 5}
                    </span>
                  </div>
                  <Slider
                    value={settings.systemServicesSettings.timelineFill?.maxQueries ?? 5}
                    min={1}
                    max={10}
                    step={1}
                    type="single"
                    onValueChange={(v) => {
                      settings.systemServicesSettings.timelineFill.maxQueries = v
                      settings.saveSystemServicesSettings()
                    }}
                  />
                  <p class="text-muted-foreground text-xs">
                    Number of questions generated to query chapter history
                  </p>
                </div>
              {/if}

              <!-- Agentic Mode Options -->
              {#if settings.systemServicesSettings.timelineFill?.mode === 'agentic'}
                <div class="space-y-3">
                  <div class="flex justify-between">
                    <Label>Max Iterations</Label>
                    <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                      {settings.systemServicesSettings.agenticRetrieval?.maxIterations ?? 30}
                    </span>
                  </div>
                  <Slider
                    value={settings.systemServicesSettings.agenticRetrieval?.maxIterations ?? 30}
                    min={1}
                    max={30}
                    step={1}
                    type="single"
                    onValueChange={(v) => {
                      settings.systemServicesSettings.agenticRetrieval.maxIterations = v
                      settings.saveSystemServicesSettings()
                    }}
                  />
                  <p class="text-muted-foreground text-xs">
                    Maximum tool-calling rounds for the retrieval agent
                  </p>
                </div>
              {/if}
            {/if}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>

    <!-- Context Window Settings -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={showContextWindowSection}>
        <div class="flex items-center gap-3 p-3 pl-4">
          <Collapsible.Trigger class="group/trigger flex flex-1 items-center gap-2 text-left">
            <div
              class="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 transition-colors group-hover/trigger:bg-blue-500/20"
            >
              <Layers class="h-4 w-4 text-blue-500" />
            </div>
            <div class="flex-1">
              <Label class="leading-none font-medium">Context Window</Label>
              <p class="text-muted-foreground mt-1 text-xs">
                Recent entries included in AI operations
              </p>
            </div>
          </Collapsible.Trigger>
          <div class="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              onclick={() => settings.resetContextWindowSettings()}
              title="Reset to default"
            >
              <RotateCcw class="h-3.5 w-3.5" />
            </Button>
            <Collapsible.Trigger>
              {#snippet child({ props })}
                <Button {...props} variant="ghost" size="icon" class="h-8 w-8">
                  {#if showContextWindowSection}
                    <ChevronDown class="h-4 w-4 rotate-180 transition-transform duration-200" />
                  {:else}
                    <ChevronDown class="h-4 w-4 transition-transform duration-200" />
                  {/if}
                  <span class="sr-only">Toggle</span>
                </Button>
              {/snippet}
            </Collapsible.Trigger>
          </div>
        </div>

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            <!-- Retrieval Context -->
            <div class="space-y-3">
              <div class="flex justify-between">
                <Label>Retrieval/Classification</Label>
                <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                  {settings.serviceSpecificSettings.contextWindow?.recentEntriesForRetrieval ?? 5} entries
                </span>
              </div>
              <Slider
                value={settings.serviceSpecificSettings.contextWindow?.recentEntriesForRetrieval ??
                  5}
                min={2}
                max={15}
                step={1}
                type="single"
                onValueChange={(v) => {
                  settings.serviceSpecificSettings.contextWindow.recentEntriesForRetrieval = v
                  settings.saveServiceSpecificSettings()
                }}
              />
              <p class="text-muted-foreground text-xs">
                Entries for retrieval and classification operations
              </p>
            </div>

            <!-- Tiered Context -->
            <div class="space-y-3">
              <div class="flex justify-between">
                <Label>Tiered Context Building</Label>
                <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                  {settings.serviceSpecificSettings.contextWindow?.recentEntriesForTiered ?? 10} entries
                </span>
              </div>
              <Slider
                value={settings.serviceSpecificSettings.contextWindow?.recentEntriesForTiered ?? 10}
                min={3}
                max={20}
                step={1}
                type="single"
                onValueChange={(v) => {
                  settings.serviceSpecificSettings.contextWindow.recentEntriesForTiered = v
                  settings.saveServiceSpecificSettings()
                }}
              />
              <p class="text-muted-foreground text-xs">Entries for lorebook entry injection</p>
            </div>

            <!-- Action Choices Context -->
            <div class="space-y-3">
              <div class="flex justify-between">
                <Label>Action Choices</Label>
                <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                  {settings.serviceSpecificSettings.contextWindow?.recentEntriesForChoices ?? 5} entries
                </span>
              </div>
              <Slider
                value={settings.serviceSpecificSettings.contextWindow?.recentEntriesForChoices ?? 5}
                min={1}
                max={10}
                step={1}
                type="single"
                onValueChange={(v) => {
                  settings.serviceSpecificSettings.contextWindow.recentEntriesForChoices = v
                  settings.saveServiceSpecificSettings()
                }}
              />
              <p class="text-muted-foreground text-xs">Entries for generating action choices</p>
            </div>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>

    <!-- Lorebook Limits Settings -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={showLorebookLimitsSection}>
        <div class="flex items-center gap-3 p-3 pl-4">
          <Collapsible.Trigger class="group/trigger flex flex-1 items-center gap-2 text-left">
            <div
              class="flex h-8 w-8 items-center justify-center rounded-md bg-orange-500/10 transition-colors group-hover/trigger:bg-orange-500/20"
            >
              <ListTree class="h-4 w-4 text-orange-500" />
            </div>
            <div class="flex-1">
              <Label class="leading-none font-medium">Lorebook Limits</Label>
              <p class="text-muted-foreground mt-1 text-xs">Max entries injected per operation</p>
            </div>
          </Collapsible.Trigger>
          <div class="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              onclick={() => settings.resetLorebookLimitsSettings()}
              title="Reset to default"
            >
              <RotateCcw class="h-3.5 w-3.5" />
            </Button>
            <Collapsible.Trigger>
              {#snippet child({ props })}
                <Button {...props} variant="ghost" size="icon" class="h-8 w-8">
                  {#if showLorebookLimitsSection}
                    <ChevronDown class="h-4 w-4 rotate-180 transition-transform duration-200" />
                  {:else}
                    <ChevronDown class="h-4 w-4 transition-transform duration-200" />
                  {/if}
                  <span class="sr-only">Toggle</span>
                </Button>
              {/snippet}
            </Collapsible.Trigger>
          </div>
        </div>

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            <!-- Max for Suggestions -->
            <div class="space-y-3">
              <div class="flex justify-between">
                <Label>Suggestions</Label>
                <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                  {settings.serviceSpecificSettings.lorebookLimits?.maxForSuggestions ?? 15} entries
                </span>
              </div>
              <Slider
                value={settings.serviceSpecificSettings.lorebookLimits?.maxForSuggestions ?? 15}
                min={5}
                max={30}
                step={5}
                type="single"
                onValueChange={(v) => {
                  settings.serviceSpecificSettings.lorebookLimits.maxForSuggestions = v
                  settings.saveServiceSpecificSettings()
                }}
              />
              <p class="text-muted-foreground text-xs">Max entries for suggestion generation</p>
            </div>

            <!-- Max for Action Choices -->
            <div class="space-y-3">
              <div class="flex justify-between">
                <Label>Action Choices</Label>
                <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                  {settings.serviceSpecificSettings.lorebookLimits?.maxForActionChoices ?? 12} entries
                </span>
              </div>
              <Slider
                value={settings.serviceSpecificSettings.lorebookLimits?.maxForActionChoices ?? 12}
                min={5}
                max={25}
                step={1}
                type="single"
                onValueChange={(v) => {
                  settings.serviceSpecificSettings.lorebookLimits.maxForActionChoices = v
                  settings.saveServiceSpecificSettings()
                }}
              />
              <p class="text-muted-foreground text-xs">Max entries for action choice generation</p>
            </div>

            <!-- Max per Tier -->
            <div class="space-y-3">
              <div class="flex justify-between">
                <Label>Per Tier</Label>
                <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                  {settings.serviceSpecificSettings.lorebookLimits?.maxEntriesPerTier ?? 20} entries
                </span>
              </div>
              <Slider
                value={settings.serviceSpecificSettings.lorebookLimits?.maxEntriesPerTier ?? 20}
                min={3}
                max={20}
                step={1}
                type="single"
                onValueChange={(v) => {
                  settings.serviceSpecificSettings.lorebookLimits.maxEntriesPerTier = v
                  settings.saveServiceSpecificSettings()
                }}
              />
              <p class="text-muted-foreground text-xs">Max entries per injection tier</p>
            </div>

            <!-- LLM Threshold -->
            <div class="space-y-3">
              <div class="flex justify-between">
                <Label>LLM Selection Threshold</Label>
                <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
                  {settings.serviceSpecificSettings.lorebookLimits?.llmThreshold ?? 30} entries
                </span>
              </div>
              <Slider
                value={settings.serviceSpecificSettings.lorebookLimits?.llmThreshold ?? 30}
                min={10}
                max={100}
                step={10}
                type="single"
                onValueChange={(v) => {
                  settings.serviceSpecificSettings.lorebookLimits.llmThreshold = v
                  settings.saveServiceSpecificSettings()
                }}
              />
              <p class="text-muted-foreground text-xs">
                Entry count that triggers LLM-based selection
              </p>
            </div>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  </div>
</div>
