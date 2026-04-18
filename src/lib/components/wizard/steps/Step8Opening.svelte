<script lang="ts">
  import { slide } from 'svelte/transition'
  import { FileJson, Loader2, Check, Sparkles, PenTool, Book, X, ChevronDown } from 'lucide-svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Textarea } from '$lib/components/ui/textarea'
  import * as Card from '$lib/components/ui/card'
  import * as ScrollArea from '$lib/components/ui/scroll-area'
  import { Badge } from '$lib/components/ui/badge'

  import type { StoryMode, POV, Tense } from '$lib/types'
  import type {
    ExpandedSetting,
    GeneratedOpening,
    GeneratedProtagonist,
  } from '$lib/services/ai/sdk'
  import type { Genre } from '$lib/services/ai/wizard'
  import type { POVOption } from '../wizardTypes'
  import { styleUserPlaceholders, tenseOptions } from '../wizardTypes'

  interface Props {
    // State
    storyTitle: string
    openingGuidance: string
    generatedOpening: GeneratedOpening | null
    isGeneratingOpening: boolean
    isRefiningOpening: boolean
    isEditingOpening: boolean
    openingDraft: string
    openingError: string | null
    manualOpeningText: string

    // Card import
    cardImportedFirstMessage: string | null
    cardImportedAlternateGreetings: string[]
    selectedGreetingIndex: number

    // Story context for summary
    selectedMode: StoryMode
    selectedGenre: Genre
    customGenre: string
    selectedPOV: POV
    selectedTense: Tense
    expandedSetting: ExpandedSetting | null
    protagonist: GeneratedProtagonist | null
    importedEntriesCount: number

    // Handlers
    onTitleChange: (value: string) => void
    onGuidanceChange: (value: string) => void
    onSelectedGreetingChange: (index: number) => void
    onGenerateOpening: () => void
    onRefineOpening: () => void
    onStartEdit: () => void
    onCancelEdit: () => void
    onSaveEdit: () => void
    onDraftChange: (value: string) => void
    onUseCardOpening: () => void
    onClearCardOpening: () => void
    onManualOpeningChange: (value: string) => void
    onClearGenerated: () => void
  }

  let {
    storyTitle,
    openingGuidance,
    generatedOpening,
    isGeneratingOpening,
    isRefiningOpening,
    isEditingOpening,
    openingDraft,
    openingError,
    manualOpeningText,
    cardImportedFirstMessage,
    cardImportedAlternateGreetings,
    selectedGreetingIndex,
    selectedMode,
    selectedGenre,
    customGenre,
    selectedPOV,
    selectedTense,
    expandedSetting,
    protagonist,
    importedEntriesCount,
    onTitleChange,
    onGuidanceChange,
    onSelectedGreetingChange,
    onGenerateOpening,
    onRefineOpening,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onDraftChange,
    onUseCardOpening,
    onClearCardOpening,
    onClearGenerated,
    onManualOpeningChange,
  }: Props = $props()

  let showExpandOptions = $state(false)

  // POV options for summary
  const povOptions: POVOption[] = [
    { id: 'first', label: '1st Person', example: '' },
    { id: 'second', label: '2nd Person', example: '' },
    { id: 'third', label: '3rd Person', example: '' },
  ]
</script>

<div class="space-y-4 p-1">
  <p class="text-muted-foreground">
    Give your story a title and either write your own opening scene or generate one with AI.
  </p>

  <div class="space-y-2">
    <Label>Story Title</Label>
    <Input
      type="text"
      value={storyTitle}
      oninput={(e) => onTitleChange(e.currentTarget.value)}
      placeholder="Enter a title for your adventure..."
    />
  </div>

  <!-- Imported Opening Scene from Character Card -->
  {#if cardImportedFirstMessage}
    <Card.Root class="bg-surface-800/50 border-surface-700">
      <Card.Content class="space-y-3 p-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <FileJson class="text-accent-400 h-4 w-4" />
            <h4 class="text-foreground font-medium">Imported Opening Scene</h4>
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="text-muted-foreground hover:text-foreground h-auto p-0 text-xs"
            onclick={onClearCardOpening}
          >
            Clear
          </Button>
        </div>

        <!-- Greeting Selection (if alternate greetings exist) -->
        {#if cardImportedAlternateGreetings.length > 0}
          <div>
            <Label class="text-muted-foreground mb-2 block text-xs font-medium"
              >Select Opening</Label
            >
            <div class="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={selectedGreetingIndex === 0 ? 'default' : 'secondary'}
                class="h-7 text-xs"
                onclick={() => onSelectedGreetingChange(0)}
              >
                Default
              </Button>
              {#each cardImportedAlternateGreetings as _, i (i)}
                <Button
                  size="sm"
                  variant={selectedGreetingIndex === i + 1 ? 'default' : 'secondary'}
                  class="h-7 text-xs"
                  onclick={() => onSelectedGreetingChange(i + 1)}
                >
                  Alt {i + 1}
                </Button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Preview of selected opening -->
        <Card.Root class="bg-surface-900 border-none">
          <Card.Content class="p-3">
            <ScrollArea.Root class="h-48">
              <div class="text-muted-foreground text-sm whitespace-pre-wrap">
                {@html styleUserPlaceholders(
                  selectedGreetingIndex === 0
                    ? cardImportedFirstMessage || ''
                    : cardImportedAlternateGreetings[selectedGreetingIndex - 1] || '',
                )}
              </div>
            </ScrollArea.Root>
          </Card.Content>
        </Card.Root>

        {#if (selectedGreetingIndex === 0 ? cardImportedFirstMessage : cardImportedAlternateGreetings[selectedGreetingIndex - 1])?.includes('{{user}}')}
          <p class="text-muted-foreground flex items-center gap-1 text-xs">
            <Badge
              variant="outline"
              class="bg-primary/20 text-primary border-primary/30 rounded px-1 py-0.5 font-mono text-[10px]"
            >
              {'{{user}}'}
            </Badge>
            will be replaced with your character's name
          </p>
        {/if}

        <Button size="sm" class="gap-2" onclick={onUseCardOpening}>
          <Check class="h-3 w-3" />
          Use This Opening
        </Button>
      </Card.Content>
    </Card.Root>
  {/if}

  <!-- Manual Opening Entry or AI Generation -->
  {#if storyTitle.trim()}
    <Card.Root class="bg-surface-900 border-surface-700">
      <Card.Content class="space-y-3 p-4">
        <h4 class="text-foreground font-medium">Opening Scene</h4>
        <p class="text-muted-foreground text-sm">
          Write your own opening scene or generate one with AI
        </p>

        <!-- Manual Text Entry -->
        <div class="space-y-2">
          <Label>Write Your Own Opening</Label>
          <Textarea
            value={manualOpeningText}
            oninput={(e) => onManualOpeningChange(e.currentTarget.value)}
            placeholder="Write the opening scene of your story here... Describe the setting, introduce your character, set the mood. This will be the first entry in your adventure."
            class="min-h-[140px] resize-y text-sm"
            rows={6}
            disabled={isGeneratingOpening || isRefiningOpening || generatedOpening !== null}
          />
          {#if generatedOpening}
            <p class="text-xs text-amber-400">
              AI-generated opening active. Clear it below to write your own.
            </p>
          {:else if manualOpeningText.trim()}
            <p class="text-xs text-green-400">✓ Custom opening ready</p>
          {/if}
        </div>

        <!-- Expand with AI -->
        <div class="flex items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            class="text-muted-foreground gap-2"
            onclick={() => (showExpandOptions = !showExpandOptions)}
          >
            <Sparkles class="h-3.5 w-3.5" />
            {showExpandOptions ? 'Hide AI Options' : 'Expand with AI'}
            <ChevronDown
              class="h-3 w-3 transition-transform {showExpandOptions ? 'rotate-180' : ''}"
            />
          </Button>
        </div>

        <!-- AI Expansion Panel -->
        {#if showExpandOptions}
          <div
            class="text-card-foreground bg-muted/10 space-y-3 rounded-lg border px-3 pt-1 pb-3 shadow-sm"
            transition:slide={{ duration: 150 }}
          >
            <div class="space-y-1.5">
              <Label for="opening-ai-guidance" class="text-xs">AI Guidance (Optional)</Label>
              <Textarea
                id="opening-ai-guidance"
                value={openingGuidance}
                oninput={(e) => onGuidanceChange(e.currentTarget.value)}
                placeholder="e.g., Start with a dramatic confrontation, set the scene in a rainy alley..."
                class="mt-1 h-16 resize-none text-sm"
              />
            </div>
            <div class="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                class="w-full gap-2"
                onclick={onGenerateOpening}
                disabled={isGeneratingOpening || isRefiningOpening}
              >
                {#if isGeneratingOpening}
                  <Loader2 class="h-3.5 w-3.5 animate-spin" />
                  Generating...
                {:else}
                  <Sparkles class="h-3.5 w-3.5" />
                  {generatedOpening ? 'Regenerate Opening' : 'Generate Opening with AI'}
                {/if}
              </Button>
              {#if generatedOpening}
                <Button
                  variant="secondary"
                  size="icon"
                  class="shrink-0"
                  onclick={onClearGenerated}
                  title="Clear AI-generated opening"
                >
                  <X class="h-4 w-4" />
                </Button>
              {/if}
            </div>
          </div>
        {/if}

        {#if !generatedOpening && !isGeneratingOpening && !manualOpeningText.trim() && !cardImportedFirstMessage}
          <span class="text-center text-sm text-amber-400">
            Either write your own opening or generate one with AI
          </span>
        {/if}
      </Card.Content>
    </Card.Root>
  {:else}
    <p class="text-muted-foreground -mt-3 text-sm">Enter a title to continue*</p>
  {/if}

  {#if openingError}
    <p class="text-sm text-red-400">{openingError}</p>
  {/if}

  {#if generatedOpening}
    <Card.Root class="bg-surface-900 border-surface-700">
      <Card.Content class="space-y-3 p-4">
        <div class="flex items-start justify-between gap-3">
          <h3 class="text-foreground font-semibold">
            {generatedOpening?.title || storyTitle}
          </h3>
          {#if !isEditingOpening}
            <div class="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                class="text-muted-foreground hover:text-foreground h-auto gap-1 px-2 py-1 text-xs"
                onclick={onStartEdit}
                title="Edit the opening text"
              >
                <PenTool class="h-3 w-3" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="text-accent-400 hover:text-accent-300 hover:bg-accent-950/20 h-auto gap-1 px-2 py-1 text-xs"
                onclick={onRefineOpening}
                disabled={isRefiningOpening || isGeneratingOpening}
                title="Refine using the current opening text"
              >
                {#if isRefiningOpening}
                  <Loader2 class="h-3 w-3 animate-spin" />
                  Refining...
                {:else}
                  <Sparkles class="h-3 w-3" />
                  Refine Further
                {/if}
              </Button>
            </div>
          {/if}
        </div>
        {#if isEditingOpening}
          <Textarea
            value={openingDraft ?? ''}
            oninput={(e) => onDraftChange(e.currentTarget.value)}
            class="min-h-[140px] resize-y text-sm"
            rows={6}
          />
          <div class="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onclick={onCancelEdit}>Cancel</Button>
            <Button size="sm" onclick={onSaveEdit} disabled={!openingDraft?.trim()}>
              Save Changes
            </Button>
          </div>
        {:else}
          <ScrollArea.Root class="h-64">
            <div class="prose prose-invert prose-sm max-w-none">
              <p class="text-muted-foreground whitespace-pre-wrap">
                {generatedOpening?.scene || ''}
              </p>
            </div>
          </ScrollArea.Root>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  <!-- Summary -->
  <Card.Root class="bg-surface-800 border-surface-700">
    <Card.Content class="space-y-2 p-4 text-sm">
      <h4 class="text-foreground font-medium">Story Summary</h4>
      <div class="text-muted-foreground grid grid-cols-2 gap-2">
        <div>
          <strong class="text-foreground">Mode:</strong>
          {selectedMode === 'adventure' ? 'Adventure' : 'Creative Writing'}
        </div>
        <div>
          <strong class="text-foreground">Genre:</strong>
          {selectedGenre === 'custom' ? customGenre : selectedGenre}
        </div>
        <div>
          <strong class="text-foreground">POV:</strong>
          {povOptions.find((p) => p.id === selectedPOV)?.label}
        </div>
        <div>
          <strong class="text-foreground">Tense:</strong>
          {tenseOptions.find((t) => t.id === selectedTense)?.label}
        </div>
        {#if expandedSetting}
          <div class="col-span-2">
            <strong class="text-foreground">Setting:</strong>
            {expandedSetting.name}
          </div>
        {/if}
        {#if protagonist}
          <div class="col-span-2">
            <strong class="text-foreground">Protagonist:</strong>
            {protagonist.name}
          </div>
        {/if}
        {#if importedEntriesCount > 0}
          <div class="col-span-2 flex items-center gap-2">
            <Book class="text-accent-400 h-4 w-4" />
            <strong class="text-foreground">Lorebook:</strong>
            {importedEntriesCount} entries to import
          </div>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>
</div>
