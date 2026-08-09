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
    Sparkles,
    Users,
    PenLine,
  } from '@lucide/svelte'
  import { Switch } from '$lib/components/ui/switch'
  import { Label } from '$lib/components/ui/label'
  import { Button } from '$lib/components/ui/button'
  import { Slider } from '$lib/components/ui/slider'
  import * as Collapsible from '$lib/components/ui/collapsible'
  import { Separator } from '$lib/components/ui/separator'
  import { advancedPanelView } from './advancedPanelView'
  import {
    ENTRY_RETRIEVAL_DEFAULTS,
    WORLD_STATE_INJECTION_DEFAULTS,
  } from '$lib/services/ai/core/defaults'
  import { AGENTIC_RETRIEVAL_DEFAULTS } from '$lib/services/ai/core/defaults'

  // Open/closed state for every collapsible section, keyed by id so `sectionHeader` can
  // bind to it generically instead of each section carrying its own `let`.
  //
  // Every id is listed with an explicit `false`, and `SectionId` is derived from this
  // object rather than being `string`. Both matter: `bind:open` refuses a value of
  // `undefined` when the prop has a fallback, so an id that is missing here does not
  // degrade -- it throws and takes the whole tab down. Deriving the type means a section
  // whose id is not in this list fails `npm run check` instead.
  const openSections = $state({
    entryRetrieval: false,
    worldStateInjection: false,
    memoryRetrieval: false,
    classifier: false,
    styleReviewer: false,
    loreManagement: false,
    suggestions: false,
    lorebookImport: false,
  })

  type SectionId = keyof typeof openSections

  // Manual mode toggle handler
  async function handleManualModeToggle(checked: boolean) {
    await settings.setAdvancedManualMode(checked)
  }

  // Debug mode toggle handler
  function handleDebugModeToggle(checked: boolean) {
    settings.setDebugMode(checked)
  }

  const system = $derived(settings.systemServicesSettings)
  const service = $derived(settings.serviceSpecificSettings)

  // Which controls currently do anything, what the headers say, and how the help lines
  // are worded. Lives in `advancedPanelView` so the rules can be tested -- this project has
  // no DOM test setup, and the panel is exactly where a control quietly ceasing to matter
  // goes unnoticed.
  const view = $derived(advancedPanelView(system))

  interface SectionConfig {
    /** Must be a key of `openSections`; see the note there. */
    id: SectionId
    title: string
    subtitle: string
    /** Any lucide-svelte icon; they all share this shape. */
    icon: typeof Search
    /** Full Tailwind classes, not fragments -- the scanner only sees literals. */
    iconWrap: string
    iconColor: string
    onReset: () => void
    badge?: { text: string; muted?: boolean }
  }

  interface SliderConfig {
    label: string
    value: number
    min: number
    max: number
    step: number
    onChange: (value: number) => void
    /** Reading shown in the pill. Defaults to the raw value. */
    display?: string
    /** Explanatory line under the control. */
    help?: string
    /** Labels for the two ends of the track, in place of `help`. */
    ends?: [string, string]
    /** When set, the control is dimmed, taken out of the tab order, and explained. */
    inactiveReason?: string
  }

  interface SwitchConfig {
    label: string
    description: string
    checked: boolean
    onChange: (checked: boolean) => void
  }

  const saveSystem = () => settings.saveSystemServicesSettings()
  const saveService = () => settings.saveServiceSpecificSettings()
</script>

{#snippet stateBadge(text: string, muted = false)}
  <span
    class="rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase {muted
      ? 'text-muted-foreground bg-muted'
      : 'bg-primary/10 text-primary'}"
  >
    {text}
  </span>
{/snippet}

{#snippet sectionHeader(cfg: SectionConfig)}
  {@const Icon = cfg.icon}
  <div class="flex items-center gap-3 p-3 pl-4">
    <Collapsible.Trigger class="group/trigger flex flex-1 items-center gap-2 text-left">
      <div
        class="flex h-8 w-8 items-center justify-center rounded-md transition-colors {cfg.iconWrap}"
      >
        <Icon class="h-4 w-4 {cfg.iconColor}" />
      </div>
      <div class="flex-1">
        <div class="flex items-center gap-2">
          <Label class="leading-none font-medium">{cfg.title}</Label>
          {#if cfg.badge}{@render stateBadge(cfg.badge.text, cfg.badge.muted)}{/if}
        </div>
        <p class="text-muted-foreground mt-1 text-xs">{cfg.subtitle}</p>
      </div>
    </Collapsible.Trigger>
    <div class="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        onclick={cfg.onReset}
        title="Reset to default"
      >
        <RotateCcw class="h-3.5 w-3.5" />
      </Button>
      <Collapsible.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="ghost" size="icon" class="h-8 w-8">
            <ChevronDown
              class="h-4 w-4 transition-transform duration-200 {openSections[cfg.id]
                ? 'rotate-180'
                : ''}"
            />
            <span class="sr-only">Toggle</span>
          </Button>
        {/snippet}
      </Collapsible.Trigger>
    </div>
  </div>
{/snippet}

{#snippet sliderRow(cfg: SliderConfig)}
  <div class="space-y-3" class:opacity-50={!!cfg.inactiveReason} inert={!!cfg.inactiveReason}>
    <div class="flex justify-between">
      <Label>{cfg.label}</Label>
      <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
        {cfg.display ?? cfg.value}
      </span>
    </div>
    <Slider
      value={cfg.value}
      min={cfg.min}
      max={cfg.max}
      step={cfg.step}
      type="single"
      onValueChange={cfg.onChange}
    />
    {#if cfg.ends}
      <div
        class="text-muted-foreground flex justify-between text-[10px] font-medium tracking-wider uppercase"
      >
        <span>{cfg.ends[0]}</span>
        <span>{cfg.ends[1]}</span>
      </div>
    {:else if cfg.help}
      <p class="text-muted-foreground text-xs">{cfg.help}</p>
    {/if}
    {#if cfg.inactiveReason}
      <p class="text-muted-foreground/80 text-[11px] italic">Inactive — {cfg.inactiveReason}</p>
    {/if}
  </div>
{/snippet}

{#snippet switchRow(cfg: SwitchConfig)}
  <div class="flex flex-row items-center justify-between">
    <div class="space-y-0.5">
      <Label class="text-sm">{cfg.label}</Label>
      <p class="text-muted-foreground text-xs">{cfg.description}</p>
    </div>
    <Switch checked={cfg.checked} onCheckedChange={cfg.onChange} />
  </div>
{/snippet}

{#snippet groupHeading(text: string, subtitle: string)}
  <div class="px-1 pt-2">
    <h3 class="text-xs font-semibold tracking-wide uppercase">{text}</h3>
    <p class="text-muted-foreground mt-0.5 text-xs">{subtitle}</p>
  </div>
{/snippet}

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

  <!-- ==================================================================== -->
  <!-- Group 1: what is assembled into the narrator's prompt, before a turn  -->
  <!-- ==================================================================== -->
  {@render groupHeading(
    "The narrator's prompt",
    'Chosen before each turn and sent with it. Entry Retrieval and World State Injection draw from two separate pools; Memory Retrieval reaches back into past chapters.',
  )}

  <div class="space-y-3">
    <!-- Entry Retrieval -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={openSections.entryRetrieval}>
        {@render sectionHeader({
          id: 'entryRetrieval',
          title: 'Entry Retrieval',
          subtitle: 'Selects Lorebook entries (authored lore) for the prompt',
          icon: Search,
          iconWrap: 'bg-amber-500/10 group-hover/trigger:bg-amber-500/20',
          iconColor: 'text-amber-500',
          onReset: () => settings.resetEntryRetrievalSettings(),
          badge: view.badges.entryRetrieval,
        })}

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            <p class="text-muted-foreground text-xs leading-relaxed">
              Selects which <strong>Lorebook entries</strong> (`Entry` records you or the AI wrote:
              characters, locations, items, factions, concepts, events) get injected into the
              narrator prompt. Authored lore only — the current location, active characters and
              inventory are handled by <strong>World State Injection</strong> below, which selects from
              the live, turn-by-turn tracked game state. Runs on every narrator turn, in every Memory
              Retrieval mode: Agentic Retrieval reads lorebook entries while reasoning about the past,
              but does not choose which ones reach the narrator — that is decided here, and only here.
            </p>

            {@render sliderRow({
              label: 'Recent Entries Window',
              value: system.entryRetrieval?.recentEntriesCount ?? 5,
              display: `${system.entryRetrieval?.recentEntriesCount ?? 5} entries`,
              min: 2,
              max: 15,
              step: 1,
              help: view.help.entryRecentEntries,
              onChange: (v) => {
                system.entryRetrieval.recentEntriesCount = v
                saveSystem()
              },
            })}

            {@render sliderRow({
              label: 'Max Matched Entries',
              value: system.entryRetrieval?.maxTier2Entries ?? 20,
              display: `${system.entryRetrieval?.maxTier2Entries ?? 20} entries`,
              min: 5,
              max: 40,
              step: 5,
              help: 'Cap on entries pulled in by name, alias or keyword. Lower than the World State cap on purpose: a lorebook entry is a paragraph, a world-state record is a sentence.',
              onChange: (v) => {
                system.entryRetrieval.maxTier2Entries = v
                saveSystem()
              },
            })}

            {@render switchRow({
              label: 'Match Against What Is in the Scene',
              description:
                'Also look for lore about whatever World State Injection says is present — the current location, the characters in the scene, your inventory, the active quests — not only what the text names. These arrive as second-pass matches, ranked below anything named directly, so a cap drops them first. Turn it off if a dense lorebook is spending its Max Matched Entries on things nobody mentioned.',
              checked: system.entryRetrieval?.useSceneEntities ?? true,
              onChange: (v) => {
                system.entryRetrieval.useSceneEntities = v
                saveSystem()
              },
            })}

            {@render sliderRow({
              label: 'Include-All Budget',
              value:
                system.entryRetrieval?.tier3WholesaleWordBudget ??
                ENTRY_RETRIEVAL_DEFAULTS.tier3WholesaleWordBudget,
              display: `${
                system.entryRetrieval?.tier3WholesaleWordBudget ??
                ENTRY_RETRIEVAL_DEFAULTS.tier3WholesaleWordBudget
              } words`,
              min: 100,
              max: 2500,
              step: 100,
              help: 'How much unmatched lore can still go in whole. If the leftover fits this budget, all of it is included and no LLM is called; if it is larger, the LLM picks from it — or, with the switch below off, none of it goes in. Raising this trades a longer prompt for one fewer LLM call per turn.',
              onChange: (v) => {
                system.entryRetrieval.tier3WholesaleWordBudget = v
                saveSystem()
              },
            })}

            {@render switchRow({
              label: 'Use the LLM to Pick Entries Above the Budget',
              description:
                'When the leftover is larger than the budget, let the LLM choose which entries matter. With this off, an oversized leftover is dropped instead — a leftover that fits the budget still goes in either way.',
              checked: view.entryLLMOn,
              onChange: (v) => {
                system.entryRetrieval.enableLLMSelection = v
                saveSystem()
              },
            })}

            {@render sliderRow({
              label: 'Max LLM-Selected Entries',
              value: system.entryRetrieval?.maxTier3Entries ?? 30,
              display: `${system.entryRetrieval?.maxTier3Entries ?? 30} entries`,
              min: 5,
              max: 50,
              step: 5,
              help: 'Cap on what the LLM picked. Applies only above the budget — below it the whole leftover goes in uncapped.',
              inactiveReason: view.inactive.maxTier3Entries,
              onChange: (v) => {
                system.entryRetrieval.maxTier3Entries = v
                saveSystem()
              },
            })}

            {@render sliderRow({
              label: 'Max Words Per Entry',
              value: system.entryRetrieval?.maxWordsPerEntry ?? 0,
              display:
                (system.entryRetrieval?.maxWordsPerEntry ?? 0) === 0
                  ? 'Unlimited'
                  : String(system.entryRetrieval?.maxWordsPerEntry ?? 0),
              min: 0,
              max: 500,
              step: 50,
              ends: ['Unlimited', '500 Words'],
              help: 'Truncates each description when the block is written, whichever tier it came from.',
              onChange: (v) => {
                system.entryRetrieval.maxWordsPerEntry = v
                saveSystem()
              },
            })}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>

    <!-- World State Injection -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={openSections.worldStateInjection}>
        {@render sectionHeader({
          id: 'worldStateInjection',
          title: 'World State Injection',
          subtitle: 'Selects live-tracked characters, locations, items & quests for the prompt',
          icon: Users,
          iconWrap: 'bg-teal-500/10 group-hover/trigger:bg-teal-500/20',
          iconColor: 'text-teal-500',
          onReset: () => settings.resetWorldStateInjectionSettings(),
          badge: view.badges.worldState,
        })}

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            <p class="text-muted-foreground text-xs leading-relaxed">
              Selects which pieces of the story's <strong>live-tracked World State</strong> -- the
              `Character`/`Location`/`Item`/`StoryBeat` records that the "World State Classifier"
              updates after every narrator turn (who's present, where you are, your inventory,
              active quests) -- get injected into the prompt. Separate from
              <strong>Entry Retrieval</strong> above, which selects from authored Lorebook entries
              instead. Unlike Entry Retrieval, this runs in full on <strong>every</strong> narrator turn,
              in every Memory Retrieval mode: Agentic Retrieval searches Lorebook entries and chapters,
              never live World State, so there is nothing here for it to stand in for.
            </p>

            {@render sliderRow({
              label: 'Recent Entries Window',
              value: system.worldStateInjection?.recentEntriesCount ?? 5,
              display: `${system.worldStateInjection?.recentEntriesCount ?? 5} entries`,
              min: 2,
              max: 15,
              step: 1,
              help: view.help.worldStateRecentEntries,
              onChange: (v) => {
                system.worldStateInjection.recentEntriesCount = v
                saveSystem()
              },
            })}

            {@render sliderRow({
              label: 'Max Matched Entities',
              value: system.worldStateInjection?.maxTier2Entries ?? 40,
              display: `${system.worldStateInjection?.maxTier2Entries ?? 40} entities`,
              min: 5,
              max: 60,
              step: 5,
              help: 'Cap on entities pulled in by name matching.',
              onChange: (v) => {
                system.worldStateInjection.maxTier2Entries = v
                saveSystem()
              },
            })}

            {@render sliderRow({
              label: 'Include-All Budget',
              value:
                system.worldStateInjection?.tier3WholesaleWordBudget ??
                WORLD_STATE_INJECTION_DEFAULTS.tier3WholesaleWordBudget,
              display: `${
                system.worldStateInjection?.tier3WholesaleWordBudget ??
                WORLD_STATE_INJECTION_DEFAULTS.tier3WholesaleWordBudget
              } words`,
              min: 100,
              max: 2500,
              step: 100,
              help: 'How much not-yet-selected world state can still go in whole. If the leftover fits this budget, all of it is included and no LLM is called; if it is larger, the LLM picks from it — or, with the switch below off, none of it goes in. A live record runs about 16 words, so 500 is roughly 30 of them.',
              onChange: (v) => {
                system.worldStateInjection.tier3WholesaleWordBudget = v
                saveSystem()
              },
            })}

            {@render switchRow({
              label: 'Use the LLM to Pick Entities Above the Budget',
              description:
                'When the leftover is larger than the budget, let the LLM choose which characters, locations, items and quests matter. With this off, an oversized leftover is dropped instead — a leftover that fits the budget still goes in either way.',
              checked: view.worldStateLLMOn,
              onChange: (v) => {
                system.worldStateInjection.enableLLMSelection = v
                saveSystem()
              },
            })}

            {@render sliderRow({
              label: 'Max LLM-Selected Entities',
              value: system.worldStateInjection?.maxTier3Entries ?? 50,
              display: `${system.worldStateInjection?.maxTier3Entries ?? 50} entities`,
              min: 5,
              max: 80,
              step: 5,
              help: "Cap on what the LLM picked. Applies only above the budget — below it the whole leftover goes in uncapped. Always-included state (where you are, who's present, what you're carrying, active quests) and the recently-mentioned carry-over are never capped.",
              inactiveReason: view.inactive.worldStateMaxTier3,
              onChange: (v) => {
                system.worldStateInjection.maxTier3Entries = v
                saveSystem()
              },
            })}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>

    <!-- Memory Retrieval -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={openSections.memoryRetrieval}>
        {@render sectionHeader({
          id: 'memoryRetrieval',
          title: 'Memory Retrieval',
          subtitle: 'How past chapters are retrieved for context',
          icon: Sparkles,
          iconWrap: 'bg-pink-500/10 group-hover/trigger:bg-pink-500/20',
          iconColor: 'text-pink-500',
          onReset: () => {
            settings.resetTimelineFillSettings()
            settings.resetAgenticRetrievalSettings()
          },
          badge: view.badges.memory,
        })}

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            {@render switchRow({
              label: 'Enable Memory Retrieval',
              description: 'Retrieve context from past chapters during generation',
              checked: view.memoryOn,
              onChange: (v) => {
                system.timelineFill.enabled = v
                saveSystem()
              },
            })}

            {#if view.memoryOn}
              <!-- Mode Selection -->
              <div class="space-y-3">
                <Label>Retrieval Mode</Label>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    class="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors {view.memoryMode ===
                    'static'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'}"
                    onclick={() => {
                      system.timelineFill.mode = 'static'
                      saveSystem()
                    }}
                  >
                    <span class="text-sm font-medium">Static</span>
                    <span class="text-muted-foreground text-xs">
                      Generates questions, then answers them from chapters
                    </span>
                  </button>
                  <button
                    class="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors {view.memoryMode ===
                    'agentic'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'}"
                    onclick={() => {
                      system.timelineFill.mode = 'agentic'
                      saveSystem()
                    }}
                  >
                    <span class="text-sm font-medium">Agentic</span>
                    <span class="text-muted-foreground text-xs">
                      LLM agent explores chapters and entries with tools
                    </span>
                  </button>
                </div>
              </div>

              {#if view.memoryMode === 'static'}
                {@render sliderRow({
                  label: 'Max Queries',
                  value: system.timelineFill?.maxQueries ?? 5,
                  min: 1,
                  max: 10,
                  step: 1,
                  help: 'Number of questions generated to query chapter history',
                  onChange: (v) => {
                    system.timelineFill.maxQueries = v
                    saveSystem()
                  },
                })}
              {/if}

              {#if view.memoryMode !== 'static'}
                {@render sliderRow({
                  label: 'Max Iterations',
                  value:
                    system.agenticRetrieval?.maxIterations ??
                    AGENTIC_RETRIEVAL_DEFAULTS.maxIterations,
                  min: 5,
                  max: 50,
                  step: 5,
                  help: 'Maximum tool-calling rounds for the retrieval agent',
                  onChange: (v) => {
                    system.agenticRetrieval.maxIterations = v
                    saveSystem()
                  },
                })}

                {@render switchRow({
                  label: 'Enable Grep Tool',
                  description:
                    'Give the agent a no-LLM tool to search verbatim story text across chapters. It looks things up directly instead of asking a second model to read whole chapters, which is far cheaper.',
                  checked: view.grepOn,
                  onChange: (v) => {
                    system.agenticRetrieval.grepEnabled = v
                    saveSystem()
                  },
                })}

                {#if view.grepOn}
                  {@render sliderRow({
                    label: 'Quotes Per Search',
                    value: system.agenticRetrieval?.grepExcerptsPerSearch ?? 40,
                    display: `${system.agenticRetrieval?.grepExcerptsPerSearch ?? 40} quotes`,
                    min: 5,
                    max: 60,
                    step: 1,
                    help: 'How much of one search the agent gets to read. Too low and a broad search shows a few percent of its hits, which is not enough to answer with — the agent then falls back to reading a whole chapter with a second model, which costs far more than the quotes would have.',
                    onChange: (v) => {
                      system.agenticRetrieval.grepExcerptsPerSearch = v
                      saveSystem()
                    },
                  })}
                {/if}
              {/if}
            {/if}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  </div>

  <Separator />

  <!-- ==================================================================== -->
  <!-- Group 2: work that happens after the narrator has answered            -->
  <!-- ==================================================================== -->
  {@render groupHeading(
    'After each turn',
    'Reads the narration that was just produced. Nothing here affects the turn it runs on — only later ones, through the state and notes it leaves behind.',
  )}

  <div class="space-y-3">
    <!-- World State Classifier -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={openSections.classifier}>
        {@render sectionHeader({
          id: 'classifier',
          title: 'World State Classifier',
          subtitle: 'Extracts world state changes from each narration',
          icon: Brain,
          iconWrap: 'bg-cyan-500/10 group-hover/trigger:bg-cyan-500/20',
          iconColor: 'text-cyan-500',
          onReset: () => settings.resetClassifierSettings(),
        })}

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            {@render sliderRow({
              label: 'Chat History Truncation (Words)',
              value: system.classifier?.chatHistoryTruncation ?? 0,
              display:
                (system.classifier?.chatHistoryTruncation ?? 0) === 0
                  ? 'No Limit'
                  : String(system.classifier?.chatHistoryTruncation ?? 0),
              min: 0,
              max: 500,
              step: 50,
              ends: ['Unlimited', '500 Words'],
              onChange: (v) => {
                system.classifier.chatHistoryTruncation = v
                saveSystem()
              },
            })}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>

    <!-- Style Reviewer -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={openSections.styleReviewer}>
        {@render sectionHeader({
          id: 'styleReviewer',
          title: 'Style Reviewer',
          subtitle: 'Detects repetitive phrases and prose patterns from recent narration',
          icon: PenLine,
          iconWrap: 'bg-violet-500/10 group-hover/trigger:bg-violet-500/20',
          iconColor: 'text-violet-500',
          onReset: () => settings.resetStyleReviewerSettings(),
          badge: view.badges.styleReviewer,
        })}

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            {@render switchRow({
              label: 'Enable Style Reviewer',
              description:
                'Periodically analyze recent narration for overused phrases and structural repetition, feeding the results back into the narrator prompt',
              checked: view.styleReviewerOn,
              onChange: (v) => {
                system.styleReviewer.enabled = v
                saveSystem()
              },
            })}

            {#if view.styleReviewerOn}
              {@render sliderRow({
                label: 'Review Every',
                value: system.styleReviewer?.triggerInterval ?? 6,
                display: `${system.styleReviewer?.triggerInterval ?? 6} turns`,
                min: 2,
                max: 32,
                step: 1,
                help: 'How often the review runs. Its findings stay in the narrator prompt between runs, so a short interval costs a call more often without changing what the narrator sees in between.',
                onChange: (v) => {
                  system.styleReviewer.triggerInterval = v
                  saveSystem()
                },
              })}

              {@render sliderRow({
                label: 'Recent Entries Window',
                value: system.styleReviewer?.recentEntriesCount ?? 32,
                display: `${system.styleReviewer?.recentEntriesCount ?? 32} entries`,
                min: 4,
                max: 64,
                step: 1,
                help: 'Most recent narration entries analyzed for repetition. Player action entries are always ignored.',
                onChange: (v) => {
                  system.styleReviewer.recentEntriesCount = v
                  saveSystem()
                },
              })}
            {/if}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>

    <!-- Lore Management -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={openSections.loreManagement}>
        {@render sectionHeader({
          id: 'loreManagement',
          title: 'Lore Management',
          subtitle: 'Autonomous agent limits and consolidation',
          icon: BookOpen,
          iconWrap: 'bg-purple-500/10 group-hover/trigger:bg-purple-500/20',
          iconColor: 'text-purple-500',
          onReset: () => settings.resetLoreManagementSettings(),
        })}

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            {@render sliderRow({
              label: 'Max Iterations',
              value: system.loreManagement?.maxIterations ?? 50,
              min: 10,
              max: 100,
              step: 5,
              ends: ['Conservative', 'Extensive'],
              onChange: (v) => {
                system.loreManagement.maxIterations = v
                saveSystem()
              },
            })}

            {@render switchRow({
              label: 'Require duplicate consolidation',
              description:
                'Entries with matching or near-identical names are listed for the agent either way. With this on, it cannot end the session until it has merged each group or declared it two separate things — which is what stops a lorebook growing duplicates, at the cost of a longer run.',
              checked: service.loreManagement?.requireDuplicateResolution ?? false,
              onChange: (v) => {
                service.loreManagement.requireDuplicateResolution = v
                saveService()
              },
            })}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  </div>

  <Separator />

  <!-- ==================================================================== -->
  <!-- Group 3: everything that is not the narrator turn                     -->
  <!-- ==================================================================== -->
  {@render groupHeading(
    'Suggestions and import',
    'Side features with their own context budgets. None of these touch the narration itself.',
  )}

  <div class="space-y-3">
    <!-- Suggestions & Choices (was "Context Window") -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={openSections.suggestions}>
        {@render sectionHeader({
          id: 'suggestions',
          title: 'Suggestions & Choices',
          subtitle: 'How much context the suggestion and action-choice generators get',
          icon: Layers,
          iconWrap: 'bg-blue-500/10 group-hover/trigger:bg-blue-500/20',
          iconColor: 'text-blue-500',
          onReset: () => {
            settings.resetContextWindowSettings()
            settings.resetLorebookLimitsSettings()
          },
        })}

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            {@render sliderRow({
              label: 'Plot Suggestions',
              value: service.contextWindow?.recentEntriesForRetrieval ?? 5,
              display: `${service.contextWindow?.recentEntriesForRetrieval ?? 5} entries`,
              min: 2,
              max: 15,
              step: 1,
              help: 'Recent story entries read when generating plot suggestions. Entry Retrieval and World State Injection have their own Recent Entries Window; this is not it.',
              onChange: (v) => {
                service.contextWindow.recentEntriesForRetrieval = v
                saveService()
              },
            })}

            {@render sliderRow({
              label: 'Action Choices',
              value: service.contextWindow?.recentEntriesForChoices ?? 5,
              display: `${service.contextWindow?.recentEntriesForChoices ?? 5} entries`,
              min: 1,
              max: 10,
              step: 1,
              help: 'Entries for generating action choices',
              onChange: (v) => {
                service.contextWindow.recentEntriesForChoices = v
                saveService()
              },
            })}

            {@render sliderRow({
              label: 'Suggestions (lorebook entries)',
              value: service.lorebookLimits?.maxForSuggestions ?? 15,
              display: `${service.lorebookLimits?.maxForSuggestions ?? 15} entries`,
              min: 5,
              max: 30,
              step: 5,
              help: 'Max lorebook entries included when generating plot suggestions',
              onChange: (v) => {
                service.lorebookLimits.maxForSuggestions = v
                saveService()
              },
            })}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>

    <!-- Lorebook Import -->
    <div class="bg-card text-card-foreground rounded-lg border shadow-sm">
      <Collapsible.Root bind:open={openSections.lorebookImport}>
        {@render sectionHeader({
          id: 'lorebookImport',
          title: 'Lorebook Import',
          subtitle: 'Batch size and concurrency',
          icon: FolderOpen,
          iconWrap: 'bg-green-500/10 group-hover/trigger:bg-green-500/20',
          iconColor: 'text-green-500',
          onReset: () => settings.resetLorebookClassifierSpecificSettings(),
        })}

        <Collapsible.Content>
          <div class="bg-muted/10 space-y-6 border-t p-4">
            {@render sliderRow({
              label: 'Batch Size',
              value: service.lorebookClassifier?.batchSize ?? 50,
              min: 10,
              max: 100,
              step: 10,
              ends: ['Reliable', 'Fast'],
              onChange: (v) => {
                service.lorebookClassifier.batchSize = v
                saveService()
              },
            })}

            {@render sliderRow({
              label: 'Max Concurrent Requests',
              value: service.lorebookClassifier?.maxConcurrent ?? 5,
              min: 1,
              max: 10,
              step: 1,
              ends: ['Sequential', 'Parallel'],
              onChange: (v) => {
                service.lorebookClassifier.maxConcurrent = v
                saveService()
              },
            })}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  </div>
</div>
