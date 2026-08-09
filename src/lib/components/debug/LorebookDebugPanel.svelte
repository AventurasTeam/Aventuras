<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte'
  import { story } from '$lib/stores/story.svelte'
  import {
    toRetrievalSnapshot,
    positionsToTurns,
    splitTier1,
    splitTier2,
    splitTier3,
    type RetrievalSnapshot,
    type RetrievalSnapshotEntry,
  } from '$lib/services/ai/retrieval'
  import { Button } from '$lib/components/ui/button'
  import {
    BookOpen,
    Globe,
    Users,
    MapPin,
    Package,
    Shield,
    Lightbulb,
    Calendar,
    SquarePen,
    PanelRight,
    PinOff,
    X,
    ChevronDown,
    Loader2,
    Merge,
  } from '@lucide/svelte'
  import { runManualLoreManagement } from '$lib/services/generation'
  import DuplicatesModal from '$lib/components/duplicates/DuplicatesModal.svelte'

  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import * as Collapsible from '$lib/components/ui/collapsible'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { Badge } from '$lib/components/ui/badge'
  import { Card, CardContent } from '$lib/components/ui/card'
  import { Separator } from '$lib/components/ui/separator'
  import { cn } from '$lib/utils/cn'
  import type { SidebarTab } from '$lib/types'
  import { countTokens } from '$lib/services/tokenizer'

  /**
   * Live for the turn that just ran, persisted for every other case.
   *
   * The in-memory copy belongs to this session, so on a fresh start — or after a story
   * switch — it is the snapshot on the last narration that has the answer. The live branch
   * counts its own tokens here, from blocks it still holds; the persisted one carries the
   * count taken when those blocks were built, since they are not stored.
   */
  let duplicatesOpen = $state(false)

  const snapshot = $derived<RetrievalSnapshot | null>(
    toRetrievalSnapshot(ui.lastLorebookRetrieval, ui.lastWorldStateRetrieval, countTokens) ??
      story.entries.findLast((e) => e.type === 'narration')?.metadata?.retrievalSnapshot ??
      null,
  )

  const sections = $derived(
    snapshot
      ? [
          {
            title: 'Lorebook',
            icon: BookOpen,
            entries: snapshot.lorebook,
            tokens: snapshot.tokens?.lorebook ?? 0,
          },
          {
            title: 'World State',
            icon: Globe,
            entries: snapshot.worldState,
            tokens: snapshot.tokens?.worldState ?? 0,
          },
        ].filter((s) => s.entries.length > 0)
      : [],
  )

  const total = $derived(sections.reduce((sum, s) => sum + s.entries.length, 0))
  const totalTokens = $derived(sections.reduce((sum, s) => sum + s.tokens, 0))

  /**
   * Tier 1 is three different things wearing one label, so it is shown as three.
   *
   * The distinction is the whole reason to open this panel: an always-inject entry is in
   * every prompt until someone changes it, a carry-over leaves on its own in a few turns,
   * and live state comes and goes with the scene. Only the first is a standing cost.
   */
  const groupLabels: Record<string, { label: string; description: string }> = {
    always: {
      label: 'Always Inject',
      description: 'Pinned by the author — in every prompt until the mode is changed',
    },
    carried: {
      label: 'Carried Over',
      description: 'Recently relevant; leaves on its own when the countdown runs out',
    },
    state: {
      label: 'Live State',
      description: "Where you are, who's present, what you're carrying, active quests",
    },
    matched: { label: 'Keyword Matched', description: 'Named directly by the scene' },
    viaScene: {
      label: 'Matched Through the Scene',
      description: 'Named by something the scene already pulled in, not by the scene itself',
    },
    wholesale: {
      label: 'Included Whole',
      description: 'The leftover fit within budget, so all of it went in — no LLM call needed',
    },
    selected: {
      label: 'LLM Selected',
      description: 'The leftover was over budget, so the LLM picked from it',
    },
  }

  /** Tiers 1 and 3 each cover more than one behaviour, so both are shown split. */
  function groupsOf(entries: RetrievalSnapshotEntry[]) {
    const { always, carried, pinnedByState } = splitTier1(entries)
    const { direct, viaScene } = splitTier2(entries)
    const { wholesale, selected } = splitTier3(entries)
    return [
      { key: 'always', tier: 1, entries: always },
      { key: 'carried', tier: 1, entries: carried },
      { key: 'state', tier: 1, entries: pinnedByState },
      { key: 'matched', tier: 2, entries: direct },
      { key: 'viaScene', tier: 2, entries: viaScene },
      { key: 'wholesale', tier: 3, entries: wholesale },
      { key: 'selected', tier: 3, entries: selected },
    ].filter((g) => g.entries.length > 0)
  }

  /** Leave the panel for the entry itself, which is where keywords and text are edited. */
  function openEntry(entryId: string) {
    ui.lorebookDebugOpen = false
    ui.setActivePanel('lorebook')
    ui.selectLorebookEntry(entryId)
  }

  /**
   * World state has no per-entity view, only the four sidebar tabs, so this opens the tab
   * the entity lives in rather than the entity itself.
   */
  const SIDEBAR_TAB_FOR_TYPE: Record<string, SidebarTab> = {
    character: 'characters',
    location: 'locations',
    item: 'inventory',
    storyBeat: 'quests',
  }

  function openInSidebar(type: string) {
    const tab = SIDEBAR_TAB_FOR_TYPE[type]
    if (!tab) return
    ui.lorebookDebugOpen = false
    ui.setSidebarTab(tab)
    ui.sidebarOpen = true
  }

  /**
   * A carry-over as "turns left of the window it started with".
   *
   * Both numbers are story positions on the way in — two per turn — so both are converted.
   * Reads `n/n` on the turn it was activated and `0/n` on its last one: zero margin left,
   * still in this prompt, gone from the next.
   */
  function carryOver(entry: RetrievalSnapshotEntry) {
    const left = positionsToTurns(entry.stickyPositionsLeft ?? 0)
    const total = positionsToTurns(entry.stickyPositionsTotal ?? entry.stickyPositionsLeft ?? 0)
    return { left, total, ratio: total > 0 ? left / total : 0 }
  }

  /** Fills as the window runs out, so it reads at a glance rather than by arithmetic. */
  function carryOverStyle(ratio: number): { text: string; bar: string } {
    if (ratio <= 0.34) return { text: 'text-rose-500', bar: 'bg-rose-500' }
    if (ratio <= 0.67) return { text: 'text-amber-500', bar: 'bg-amber-500' }
    return { text: 'text-emerald-500', bar: 'bg-emerald-500' }
  }

  /** End a carry-over now rather than waiting for its countdown. */
  function clearCarryOver(entryId: string) {
    ui.clearActivationFor(entryId)
  }

  /** Rounded for the header: the point is the order of magnitude, not the last digit. */
  function formatTokens(count: number): string {
    return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
  }

  /** Demote an always-inject entry to keyword matching, from where its cost is visible. */
  async function makeKeywordMatched(entryId: string) {
    const entry = story.lorebookEntries.find((e) => e.id === entryId)
    if (!entry) return
    await story.updateLorebookEntry(entryId, {
      injection: { ...entry.injection, mode: 'keyword' },
    })
  }

  const tierColors: Record<number, string> = {
    1: 'text-green-600 dark:text-green-400 border-green-500/20 bg-green-500/5',
    2: 'text-amber-600 dark:text-amber-400 border-amber-500/20 bg-amber-500/5',
    3: 'text-purple-600 dark:text-purple-400 border-purple-500/20 bg-purple-500/5',
  }

  const tierIndicatorColors: Record<number, string> = {
    1: 'bg-green-500',
    2: 'bg-amber-500',
    3: 'bg-purple-500',
  }

  const typeIcons: Record<string, typeof Users> = {
    character: Users,
    location: MapPin,
    item: Package,
    storyBeat: Calendar,
    faction: Shield,
    concept: Lightbulb,
    event: Calendar,
  }

  function getIcon(type: string) {
    return typeIcons[type] || BookOpen
  }

  function tierCount(entries: RetrievalSnapshotEntry[], tier: number): number {
    return entries.filter((e) => e.tier === tier).length
  }
</script>

{#snippet tierBadges(entries: RetrievalSnapshotEntry[])}
  <div class="flex flex-wrap gap-2">
    <Badge
      variant="outline"
      class="border-green-500/40 bg-green-500/5 text-green-700 dark:text-green-400"
      >Tier 1: {tierCount(entries, 1)}</Badge
    >
    <Badge
      variant="outline"
      class="border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
      >Tier 2: {tierCount(entries, 2)}</Badge
    >
    <Badge
      variant="outline"
      class="border-purple-500/40 bg-purple-500/5 text-purple-700 dark:text-purple-400"
      >Tier 3: {tierCount(entries, 3)}</Badge
    >
  </div>
{/snippet}

{#snippet tierGroup(
  key: string,
  tier: number,
  entries: RetrievalSnapshotEntry[],
  canDemote: boolean,
)}
  <div class="space-y-1.5">
    <div class="flex items-baseline gap-2">
      <div
        class={cn('h-2 w-2 shrink-0 translate-y-[-1px] rounded-full', tierIndicatorColors[tier])}
      ></div>
      <h4 class="text-sm font-semibold">
        {groupLabels[key].label}
        <span class="text-muted-foreground ml-1 font-normal">({entries.length})</span>
      </h4>
      <span class="text-muted-foreground/60 truncate text-[11px]"
        >{groupLabels[key].description}</span
      >
    </div>

    <div class="grid gap-1">
      {#each entries as entry, index (`${entry.type}-${entry.name}-${index}`)}
        {@const Icon = getIcon(entry.type)}
        <div
          class={cn(
            'flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm',
            tierColors[tier],
          )}
        >
          <Icon class="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span class="truncate font-medium">{entry.name}</span>

          <span
            class="text-muted-foreground shrink-0 text-[10px] tracking-wide uppercase opacity-70"
            >{entry.type}</span
          >

          {#if entry.reason && entry.stickyPositionsLeft === undefined}
            <span class="text-muted-foreground min-w-0 truncate text-xs" title={entry.reason}>
              {entry.reason.replace(/^matched:\s*/i, '')}
            </span>
          {/if}

          <span class="ml-auto flex shrink-0 items-center gap-1">
            {#if entry.stickyPositionsLeft !== undefined}
              {@const carry = carryOver(entry)}
              {@const style = carryOverStyle(carry.ratio)}
              <span
                class="flex shrink-0 items-center gap-1.5"
                title={`${carry.left} of ${carry.total} turns of carry-over left`}
              >
                <span class="bg-muted h-1 w-8 overflow-hidden rounded-full">
                  <span
                    class={cn('block h-full rounded-full transition-all', style.bar)}
                    style={`width: ${Math.max(8, carry.ratio * 100)}%`}
                  ></span>
                </span>
                <span class={cn('font-mono text-xs whitespace-nowrap', style.text)}>
                  {carry.left}/{carry.total}
                </span>
              </span>
              {#if canDemote}
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6"
                  title="Drop the carry-over now"
                  onclick={() => clearCarryOver(entry.id)}
                >
                  <X class="h-3.5 w-3.5" />
                </Button>
              {/if}
            {/if}
            {#if canDemote && entry.alwaysInject}
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6"
                title="Switch to keyword matching"
                onclick={() => makeKeywordMatched(entry.id)}
              >
                <PinOff class="h-3.5 w-3.5" />
              </Button>
            {/if}
            {#if canDemote}
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6"
                title="Open this entry in the Lorebook"
                onclick={() => openEntry(entry.id)}
              >
                <SquarePen class="h-3.5 w-3.5" />
              </Button>
            {:else if SIDEBAR_TAB_FOR_TYPE[entry.type]}
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6"
                title="Show this in the sidebar"
                onclick={() => openInSidebar(entry.type)}
              >
                <PanelRight class="h-3.5 w-3.5" />
              </Button>
            {/if}
          </span>
        </div>
      {/each}
    </div>
  </div>
{/snippet}

<ResponsiveModal.Root bind:open={ui.lorebookDebugOpen}>
  <ResponsiveModal.Content class="flex h-[80vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
    <ResponsiveModal.Header class="shrink-0 border-b px-6 py-4" title="Active Context" />

    <ScrollArea class="min-h-0 flex-1">
      <div class="space-y-6 p-6">
        {#if total > 0}
          <p class="text-muted-foreground/80 text-xs leading-relaxed">
            What the narrator was given for the <strong>last response</strong>, not a forecast of
            the next one. Counts and token totals are that turn's; carry-over countdowns are
            measured from it.
          </p>
          <Card class="bg-muted/40 shadow-sm">
            <CardContent class="space-y-4 p-4">
              <div class="flex items-center justify-between text-sm">
                <span class="text-muted-foreground font-medium">Total Active Entries</span>
                <div class="flex items-center gap-2">
                  {#if totalTokens > 0}
                    <span
                      class="text-muted-foreground bg-background rounded border px-2.5 py-0.5 font-mono text-xs"
                      title="Tokens these two blocks cost in the prompt, counted when they were built"
                      >~{formatTokens(totalTokens)} tok</span
                    >
                  {/if}
                  <span
                    class="text-foreground bg-background rounded border px-2.5 py-0.5 font-mono font-bold"
                    >{total}</span
                  >
                </div>
              </div>
              {#each sections as section (section.title)}
                {@const SectionIcon = section.icon}
                <div class="space-y-2">
                  <div class="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                    <SectionIcon class="h-3.5 w-3.5" />
                    {section.title}
                  </div>
                  {@render tierBadges(section.entries)}
                  {#if section.tokens > 0}
                    <p class="text-muted-foreground/75 text-[11px]">
                      ~{formatTokens(section.tokens)} tokens in the prompt
                    </p>
                  {/if}
                </div>
              {/each}
            </CardContent>
          </Card>

          {#each sections as section, sectionIndex (section.title)}
            {@const SectionIcon = section.icon}
            {#if sectionIndex > 0}
              <Separator class="my-6" />
            {/if}
            <div class="space-y-4">
              <h3 class="flex items-center gap-2 text-base font-semibold">
                <SectionIcon class="h-4 w-4" />
                {section.title}
              </h3>
              {#each groupsOf(section.entries) as group (group.key)}
                {@render tierGroup(
                  group.key,
                  group.tier,
                  group.entries,
                  section.title === 'Lorebook',
                )}
              {/each}
            </div>
          {/each}

          <!--
            This panel is where lore management's cost is visible — the entry pinned into
            every prompt, the duplicate listed twice — so it is where a pass is asked for.
            Same icon as its section in Settings -> Advanced: it is the same agent.
          -->
          <Separator class="my-6" />
          <div class="space-y-3">
            <div class="flex items-center justify-between gap-3">
              <p class="text-muted-foreground/80 text-xs leading-snug">
                {#if ui.loreManagementActive}
                  {ui.loreManagementProgress || 'Working...'}
                {:else}
                  Consolidates duplicates, updates entries from the story so far, and adds what is
                  missing.
                {/if}
              </p>
              <Button
                variant="ghost"
                size="sm"
                class="shrink-0"
                disabled={!story.currentStory}
                onclick={() => (duplicatesOpen = true)}
              >
                <Merge class="h-3.5 w-3.5" />
                Duplicates
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="shrink-0"
                disabled={ui.loreManagementActive || !story.currentStory}
                onclick={() => void runManualLoreManagement()}
              >
                {#if ui.loreManagementActive}
                  <Loader2 class="h-3.5 w-3.5 animate-spin" />
                  Running
                {:else}
                  <BookOpen class="h-3.5 w-3.5 text-purple-500" />
                  Run lore management
                {/if}
              </Button>
            </div>

            <!-- The agent's own account of what it changed; see ui.lastLoreManagementSummary. -->
            {#if !ui.loreManagementActive && ui.lastLoreManagementSummary}
              <div class="bg-muted/40 space-y-1 rounded-lg border p-3">
                <p class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                  Last run · {ui.lastLoreManagementChanges}
                  {ui.lastLoreManagementChanges === 1 ? 'change' : 'changes'}
                </p>
                <p class="text-foreground/90 text-xs leading-relaxed">
                  {ui.lastLoreManagementSummary}
                </p>
              </div>
            {/if}
          </div>

          {#if ui.lastWorldStateRetrieval?.contextBlock || ui.lastLorebookRetrieval?.contextBlock}
            <Separator class="my-6" />
            <div class="space-y-4">
              <h3 class="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Injected Prompt Blocks
              </h3>

              {#if ui.lastWorldStateRetrieval?.contextBlock}
                <Collapsible.Root class="bg-muted/20 rounded-lg border">
                  <Collapsible.Trigger
                    class="group hover:bg-muted/30 flex w-full items-center justify-between rounded-lg p-3 text-left transition-colors"
                  >
                    <div class="text-foreground/90 flex items-center gap-2 text-sm font-medium">
                      <Globe class="h-4 w-4 text-emerald-500" />
                      <span>Injected World State</span>
                    </div>
                    <ChevronDown
                      class="text-muted-foreground h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180"
                    />
                  </Collapsible.Trigger>
                  <Collapsible.Content>
                    <div class="bg-muted/30 border-t">
                      <ScrollArea class="h-48 w-full">
                        <div class="p-4">
                          <pre
                            class="text-muted-foreground font-mono text-xs break-words whitespace-pre-wrap">{ui
                              .lastWorldStateRetrieval.contextBlock}</pre>
                        </div>
                      </ScrollArea>
                    </div>
                  </Collapsible.Content>
                </Collapsible.Root>
              {/if}

              {#if ui.lastLorebookRetrieval?.contextBlock}
                <Collapsible.Root class="bg-muted/20 rounded-lg border">
                  <Collapsible.Trigger
                    class="group hover:bg-muted/30 flex w-full items-center justify-between rounded-lg p-3 text-left transition-colors"
                  >
                    <div class="text-foreground/90 flex items-center gap-2 text-sm font-medium">
                      <BookOpen class="h-4 w-4 text-purple-500" />
                      <span>Injected Lorebook Block</span>
                    </div>
                    <ChevronDown
                      class="text-muted-foreground h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180"
                    />
                  </Collapsible.Trigger>
                  <Collapsible.Content>
                    <div class="bg-muted/30 border-t">
                      <ScrollArea class="h-48 w-full">
                        <div class="p-4">
                          <pre
                            class="text-muted-foreground font-mono text-xs break-words whitespace-pre-wrap">{ui
                              .lastLorebookRetrieval.contextBlock}</pre>
                        </div>
                      </ScrollArea>
                    </div>
                  </Collapsible.Content>
                </Collapsible.Root>
              {/if}
            </div>
          {/if}
        {:else}
          <div class="text-muted-foreground flex flex-col items-center justify-center py-20">
            <div class="bg-muted/30 mb-6 flex h-20 w-20 items-center justify-center rounded-full">
              <BookOpen class="h-10 w-10 opacity-20" />
            </div>
            <p class="text-base font-medium">No retrieval data yet</p>
            <p class="mt-2 max-w-xs text-center text-sm opacity-70">
              Generate a response to see what the narrator was given.
            </p>
          </div>
        {/if}
      </div>
    </ScrollArea>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>

{#if duplicatesOpen}
  <DuplicatesModal onClose={() => (duplicatesOpen = false)} />
{/if}
