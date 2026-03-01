<script lang="ts">
  import type { CustomVariable } from '$lib/services/packs/types'
  import type { VariableDefinition } from '$lib/services/templates/types'
  import { variableRegistry } from '$lib/services/templates/variables'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import * as Collapsible from '$lib/components/ui/collapsible'
  import * as Select from '$lib/components/ui/select'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Switch } from '$lib/components/ui/switch'
  import { Badge } from '$lib/components/ui/badge'
  import { RotateCcw, Search, ChevronDown } from 'lucide-svelte'

  interface Props {
    open: boolean
    customVariables: CustomVariable[]
    testValues: Record<string, string>
    onOpenChange: (open: boolean) => void
    onTestValuesChange: (values: Record<string, string>) => void
  }

  let { open, customVariables, testValues, onOpenChange, onTestValuesChange }: Props = $props()

  let draft = $state<Record<string, string>>({})
  let searchQuery = $state('')

  // Collapsible open states
  let systemOpen = $state(true)
  let customOpen = $state(true)
  const systemVars = variableRegistry.getByCategory('system')
  const runtimeVars = variableRegistry.getByCategory('runtime')

  // Runtime variable groupings
  const RUNTIME_GROUPS: { name: string; varNames: string[] }[] = [
    {
      name: 'Narrative',
      varNames: [
        'recentContent',
        'tieredContextBlock',
        'chapterSummaries',
        'styleGuidance',
        'retrievedChapterContext',
        'inlineImageInstructions',
        'visualProseInstructions',
        'visualProseMode',
        'inlineImageMode',
      ],
    },
    {
      name: 'Classifier',
      varNames: [
        'entityCounts',
        'currentTimeInfo',
        'chatHistoryBlock',
        'inputLabel',
        'userAction',
        'narrativeResponse',
        'existingCharacters',
        'existingLocations',
        'existingItems',
        'existingBeats',
        'storyBeatTypes',
        'itemLocationOptions',
        'defaultItemLocation',
      ],
    },
    {
      name: 'Memory',
      varNames: [
        'chapterContent',
        'previousContext',
        'messagesInRange',
        'firstValidId',
        'lastValidId',
        'recentContext',
        'maxChaptersPerRetrieval',
      ],
    },
    {
      name: 'Suggestions & Actions',
      varNames: [
        'activeThreads',
        'npcsPresent',
        'inventory',
        'activeQuests',
        'lorebookContext',
        'protagonistDescription',
        'povInstruction',
        'lengthInstruction',
        'userInput',
      ],
    },
    {
      name: 'Style & Lore',
      varNames: [
        'passageCount',
        'passages',
        'entrySummary',
        'recentStorySection',
        'chapterSummary',
      ],
    },
    {
      name: 'Retrieval',
      varNames: ['chaptersCount', 'chapterList', 'entriesCount', 'entryList', 'entrySummaries'],
    },
    {
      name: 'Translation',
      varNames: [
        'targetLanguage',
        'sourceLanguage',
        'content',
        'elementsJson',
        'suggestionsJson',
        'choicesJson',
      ],
    },
    {
      name: 'Image',
      varNames: [
        'imageStylePrompt',
        'characterDescriptors',
        'charactersWithPortraits',
        'charactersWithoutPortraits',
        'maxImages',
        'chatHistory',
        'translatedNarrativeBlock',
        'previousResponse',
        'currentResponse',
        'visualDescriptors',
      ],
    },
    {
      name: 'Wizard',
      varNames: [
        'genreLabel',
        'seed',
        'customInstruction',
        'currentSetting',
        'toneInstruction',
        'settingInstruction',
        'characterName',
        'characterDescription',
        'characterBackground',
        'settingContext',
        'currentCharacter',
        'settingName',
        'count',
        'outputFormat',
        'title',
        'atmosphereSection',
        'supportingCharactersSection',
        'tenseInstruction',
        'povPerspective',
        'povPerspectiveInstructions',
        'currentOpening',
        'openingInstruction',
        'guidanceSection',
        'cardContent',
        'lorebookName',
        'entriesJson',
        'entryCount',
        'userMessage',
        'conversationHistory',
      ],
    },
    {
      name: 'Timeline',
      varNames: ['chapterHistory', 'timeline', 'query'],
    },
  ]

  const runtimeGroups = $derived.by(() =>
    RUNTIME_GROUPS.map((g) => ({
      name: g.name,
      variables: g.varNames
        .map((name) => runtimeVars.find((v) => v.name === name))
        .filter((v): v is VariableDefinition => v != null),
    })).filter((g) => g.variables.length > 0),
  )

  // Initialize runtime open states (all collapsed)
  let runtimeOpenStates = $state<Record<string, boolean>>(
    Object.fromEntries(RUNTIME_GROUPS.map((g) => [g.name, false])),
  )

  // Sync draft when modal opens
  $effect(() => {
    if (open) {
      draft = { ...testValues }
    }
  })

  function updateDraft(name: string, value: string) {
    draft = { ...draft, [name]: value }
  }

  function handleApply() {
    const cleaned = Object.fromEntries(Object.entries(draft).filter(([_, v]) => v !== ''))
    onTestValuesChange(cleaned)
    onOpenChange(false)
  }

  function matchesSearch(name: string, description: string): boolean {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return name.toLowerCase().includes(q) || description.toLowerCase().includes(q)
  }

  let filteredSystem = $derived(systemVars.filter((v) => matchesSearch(v.name, v.description)))
  let filteredCustom = $derived(
    customVariables.filter((v) =>
      matchesSearch(v.variableName, v.displayName + ' ' + (v.description ?? '')),
    ),
  )
  let filteredRuntimeGroups = $derived(
    runtimeGroups
      .map((g) => ({
        ...g,
        variables: g.variables.filter((v) => matchesSearch(v.name, v.description)),
      }))
      .filter((g) => g.variables.length > 0),
  )
  let overrideCount = $derived(Object.values(draft).filter((v) => v !== '').length)
</script>

{#snippet varInput(
  name: string,
  description: string,
  type?: string,
  enumValues?: string[],
  useTextarea: boolean = false,
)}
  <div class="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1 py-2">
    <div class="flex flex-col gap-0.5">
      <span class="text-foreground text-xs font-medium">{description}</span>
      <code class="text-muted-foreground text-[10px]">{`{{ ${name} }}`}</code>
    </div>
    <div class={useTextarea ? 'col-span-2 w-full' : 'w-48'}>
      {#if type === 'enum' && enumValues}
        <Select.Root
          type="single"
          value={draft[name] ?? ''}
          onValueChange={(v) => updateDraft(name, v)}
        >
          <Select.Trigger class="h-7 w-full text-xs">
            {draft[name] || ''}
          </Select.Trigger>
          <Select.Content>
            {#each enumValues as opt (opt)}
              <Select.Item value={opt} label={opt}>{opt}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      {:else if type === 'boolean'}
        <div class="flex h-7 items-center">
          <Switch
            checked={(draft[name] ?? '') === 'true'}
            onCheckedChange={(v) => updateDraft(name, v ? 'true' : 'false')}
          />
        </div>
      {:else if type === 'number'}
        <Input
          type="number"
          value={draft[name] ?? ''}
          oninput={(e) => updateDraft(name, e.currentTarget.value)}
          class="h-7 text-xs"
        />
      {:else if useTextarea}
        <Textarea
          value={draft[name] ?? ''}
          oninput={(e) => updateDraft(name, e.currentTarget.value)}
          rows={2}
          class="text-xs"
        />
      {:else}
        <Input
          value={draft[name] ?? ''}
          oninput={(e) => updateDraft(name, e.currentTarget.value)}
          class="h-7 text-xs"
        />
      {/if}
    </div>
  </div>
{/snippet}

<ResponsiveModal.Root {open} {onOpenChange}>
  <ResponsiveModal.Content class="p-0 sm:max-w-2xl">
    <ResponsiveModal.Header class="border-b px-6 py-4">
      <ResponsiveModal.Title class="flex items-center gap-2">
        Test Variables
        {#if overrideCount > 0}
          <Badge variant="default" class="text-[10px]"
            >{overrideCount} override{overrideCount === 1 ? '' : 's'}</Badge
          >
        {/if}
      </ResponsiveModal.Title>
      <ResponsiveModal.Description>
        Override variable values to preview how templates render.
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>

    <!-- Search bar -->
    <div class="border-b px-6 py-2.5">
      <Input
        leftIcon={Search}
        placeholder="Filter variables..."
        class="h-8 text-xs"
        bind:value={searchQuery}
      />
    </div>

    <!-- Scrollable variable list -->
    <div class="max-h-[60vh] overflow-y-auto px-6 py-3">
      <div class="divide-border divide-y">
        <!-- System -->
        {#if filteredSystem.length > 0}
          <Collapsible.Root bind:open={systemOpen}>
            <Collapsible.Trigger class="flex w-full">
              <div class="flex w-full items-center gap-2 py-1.5">
                <ChevronDown
                  class="text-muted-foreground h-4 w-4 shrink-0 transition-transform duration-200 {systemOpen
                    ? ''
                    : '-rotate-90'}"
                />
                <span class="text-sm font-medium">System</span>
                <Badge variant="default" class="text-[10px]">{filteredSystem.length}</Badge>
              </div>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div class="divide-border/50 divide-y pl-6">
                {#each filteredSystem as v (v.name)}
                  {@render varInput(v.name, v.description, v.type, v.enumValues)}
                {/each}
              </div>
            </Collapsible.Content>
          </Collapsible.Root>
        {/if}

        <!-- Custom -->
        {#if filteredCustom.length > 0}
          <Collapsible.Root bind:open={customOpen}>
            <Collapsible.Trigger class="flex w-full">
              <div class="flex w-full items-center gap-2 py-1.5">
                <ChevronDown
                  class="text-muted-foreground h-4 w-4 shrink-0 transition-transform duration-200 {customOpen
                    ? ''
                    : '-rotate-90'}"
                />
                <span class="text-sm font-medium">Custom</span>
                <Badge variant="default" class="text-[10px]">{filteredCustom.length}</Badge>
              </div>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div class="divide-border/50 divide-y pl-6">
                {#each filteredCustom as v (v.id)}
                  {@render varInput(
                    v.variableName,
                    v.displayName + (v.description ? ` — ${v.description}` : ''),
                    v.variableType,
                    v.enumOptions?.map((o) => o.value),
                    v.variableType === 'textarea',
                  )}
                {/each}
              </div>
            </Collapsible.Content>
          </Collapsible.Root>
        {/if}

        <!-- Runtime groups -->
        {#each filteredRuntimeGroups as group (group.name)}
          <Collapsible.Root bind:open={runtimeOpenStates[group.name]}>
            <Collapsible.Trigger class="flex w-full">
              <div class="flex w-full items-center gap-2 py-1.5">
                <ChevronDown
                  class="text-muted-foreground h-4 w-4 shrink-0 transition-transform duration-200 {runtimeOpenStates[
                    group.name
                  ]
                    ? ''
                    : '-rotate-90'}"
                />
                <span class="text-sm font-medium">{group.name}</span>
                <Badge variant="secondary" class="text-[10px]">{group.variables.length}</Badge>
              </div>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div class="divide-border/50 divide-y pl-6">
                {#each group.variables as v (v.name)}
                  {@render varInput(v.name, v.description, v.type, v.enumValues)}
                {/each}
              </div>
            </Collapsible.Content>
          </Collapsible.Root>
        {/each}
      </div>
    </div>

    <ResponsiveModal.Footer class="px-6">
      <div class="flex w-full items-center justify-between gap-2">
        <Button variant="outline" size="sm" class="gap-1.5" onclick={() => (draft = {})}>
          <RotateCcw class="h-3.5 w-3.5" />
          Clear All
        </Button>
        <div class="flex gap-2">
          <Button variant="outline" size="sm" onclick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onclick={handleApply}>Apply</Button>
        </div>
      </div>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
