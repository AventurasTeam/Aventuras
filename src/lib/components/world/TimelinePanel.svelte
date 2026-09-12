<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { timelineLayout } from '$lib/stores/timelineLayout.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import {
    Anchor,
    Trash2,
    Wrench,
    ListChecks,
    Plus,
    Pencil as Edit,
    CornerDownLeft,
    ChevronRight,
    ChevronDown,
    Filter,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import { entryNumber } from '$lib/utils/storyNavigation'
  import { supportsHover } from '$lib/utils/platform'
  import TimelineRepairModal from './TimelineRepairModal.svelte'
  import TimelineAnomaliesModal from './TimelineAnomaliesModal.svelte'
  import TimeAnchorModal from './TimeAnchorModal.svelte'

  let repairOpen = $state(false)
  let anomaliesOpen = $state(false)
  let anchorModalOpen = $state(false)
  /** Null when adding: the modal then asks which entry to anchor. */
  let anchorModalEntryId = $state<string | null>(null)
  /** Reference points whose recorded times are unfolded. An array, not a Set: runes want one. */
  let expanded = $state<string[]>([])
  // Opt-in: nothing ticked is no filter at all, rather than a filter that hides everything.
  let filterAnchors = $state(false)
  let filterNatural = $state(false)

  function toggleTimes(entryId: string) {
    expanded = expanded.includes(entryId)
      ? expanded.filter((id) => id !== entryId)
      : [...expanded, entryId]
  }

  function openAnchorModal(entryId: string | null) {
    anchorModalEntryId = entryId
    anchorModalOpen = true
  }

  function goToEntry(entryId: string) {
    const entry = story.entries.find((e) => e.id === entryId)
    if (!entry) return
    ui.requestEntryScroll(entryId)
    ui.setActivePanel('story')
    ui.closeNavPanelOnMobile()
    if (!supportsHover()) ui.showToast(`Jumped to entry ${entryNumber(entry)}`, 'info', 2000)
  }

  function anchorEntryNumber(entryId: string): string {
    const entry = story.entries.find((e) => e.id === entryId)
    return entry ? String(entryNumber(entry)) : '—'
  }

  const forkEntryIds = $derived(new Set(story.branches.map((branch) => branch.forkEntryId)))
  const branchNames = $derived(new Map(story.branches.map((branch) => [branch.id, branch.name])))

  function branchName(branchId: string | null): string {
    if (!branchId) return 'Main'
    return branchNames.get(branchId) ?? 'Unknown branch'
  }

  // Boundaries arrive in story order, one per entry. Their roles are read back from the story
  // rather than from `Boundary.kind`, which names only the one that won the tie: an anchored
  // fork point is both, and the list is where that has to show.
  const rows = $derived(
    story.timeBoundaries.map((boundary) => {
      const entry = story.entries.find((e) => e.id === boundary.entryId)
      const anchor = story.timeAnchorFor(boundary.entryId) ?? null
      const checkpoint = story.checkpoints.find((c) => c.lastEntryId === boundary.entryId) ?? null
      return {
        boundary,
        anchor,
        checkpoint,
        // Independent of the anchor: asserting a time does not stop the entry being where the
        // story opens, ends, forks, or was checkpointed.
        natural:
          boundary.index === 0 ||
          boundary.index === story.entries.length - 1 ||
          forkEntryIds.has(boundary.entryId) ||
          checkpoint !== null,
        entryEnd: entry?.metadata?.timeEnd ?? null,
        roles: [
          boundary.index === 0 ? 'Beginning' : null,
          boundary.index === story.entries.length - 1 ? 'Current end' : null,
          // A branch can only be forked from a checkpoint, so naming both repeats one fact.
          // Worth saying only when the checkpoint is gone and nothing else explains the wall.
          !checkpoint && forkEntryIds.has(boundary.entryId) ? 'Branch point' : null,
        ].filter((role): role is string => role !== null),
        branch: branchName(entry?.branchId ?? null),
      }
    }),
  )

  const filtered = $derived(filterAnchors || filterNatural)
  // Either qualifies, so a point that is both stays visible while either box is ticked.
  const shown = $derived(
    filtered
      ? rows.filter((row) => (row.anchor && filterAnchors) || (row.natural && filterNatural))
      : rows,
  )

  const report = $derived(story.timelineReport)
  const defects = $derived(report.anomalies.filter((a) => a.severity === 'defect').length)
  const suspected = $derived(report.anomalies.filter((a) => a.severity === 'suspected').length)

  function pad(n: number, width: number = 2): string {
    return n.toString().padStart(width, '0')
  }

  function stamp(time: { years: number; days: number; hours: number; minutes: number }): string {
    return `Y${time.years + 1} D${time.days + 1} ${pad(time.hours)}:${pad(time.minutes)}`
  }
</script>

<div class="mb-2 flex items-center justify-between gap-2">
  <h3 class="text-foreground text-xl font-bold tracking-tight">Timeline</h3>
  <!-- TEMPORARY: compare both reconcile layouts on one dev run. Remove with
       `timelineLayout` and the branches it drives in TimelineRepairModal. -->
  <Button
    variant="outline"
    size="sm"
    class="h-7 text-xs"
    onclick={() => timelineLayout.toggle()}
    title="Temporary: switch the reconcile dialog layout"
  >
    {timelineLayout.mobile ? 'Mobile' : 'Desktop'}
  </Button>
</div>

<!-- What the recorded timeline looks like, and what has been asserted about it -->
<div class="border-border bg-card rounded-lg border p-3 shadow-sm">
  <dl class="text-xs">
    <div class="flex justify-between gap-3 py-0.5">
      <dt class="text-muted-foreground">Asserted through</dt>
      <dd class="text-right">
        {#if report.asserted.assertedTime}
          {stamp(report.asserted.assertedTime)}
          {#if report.asserted.agrees === false}
            <span class="text-amber-600 dark:text-amber-500"> (disagrees with record)</span>
          {/if}
        {:else}
          <span class="text-muted-foreground">nothing asserted</span>
        {/if}
      </dd>
    </div>
    {#if report.asserted.entryId}
      <div class="flex justify-between gap-3 py-0.5">
        <dt class="text-muted-foreground">Since then</dt>
        <dd class="text-right">
          {report.asserted.entriesAfter}
          {report.asserted.entriesAfter === 1 ? 'entry' : 'entries'},
          {#if report.asserted.elapsedAfter}
            {stamp(report.asserted.elapsedAfter)}
          {:else}
            elapsed time unavailable
          {/if}
        </dd>
      </div>
    {/if}
    <div class="flex justify-between gap-3 py-0.5">
      <dt class="text-muted-foreground">Anomalies</dt>
      <dd class="text-right">
        {#if defects === 0 && suspected === 0}
          none found
        {:else}
          {#if defects > 0}<span class="text-destructive">{defects} definite</span>{/if}
          {#if defects > 0 && suspected > 0}<span>, </span>{/if}
          {#if suspected > 0}<span class="text-muted-foreground">{suspected} suspected</span>{/if}
        {/if}
      </dd>
    </div>
  </dl>

  {#if report.anomalies.length > 0}
    <Button
      variant="outline"
      size="sm"
      class="mt-2 h-7 w-full text-xs"
      onclick={() => (anomaliesOpen = true)}
    >
      <ListChecks class="h-3.5 w-3.5" />
      Review {report.anomalies.length}
      {report.anomalies.length === 1 ? 'anomaly' : 'anomalies'}
    </Button>
  {/if}
</div>

<!-- Anchors: the reader's own assertions, and the only thing a repair measures from -->
<div class="border-border bg-card mt-3 rounded-lg border p-3 shadow-sm">
  <div class="mb-2 flex items-center justify-between">
    <h4 class="text-foreground text-sm font-semibold">Reference points</h4>
    <div class="flex items-center gap-1">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              variant="outline"
              size="icon"
              class="h-7 w-7 {filtered ? 'text-amber-500' : ''}"
              aria-label="Filter reference points"
              title="Filter reference points"
              {...props}
            >
              <Filter class="h-3.5 w-3.5" />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <!-- Stays open: the two boxes are read against each other, so closing after one
               would make comparing them a matter of reopening the menu each time. -->
          <DropdownMenu.CheckboxItem bind:checked={filterAnchors} closeOnSelect={false}>
            Anchors
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.CheckboxItem bind:checked={filterNatural} closeOnSelect={false}>
            Natural boundaries
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <Button
        variant="outline"
        size="icon"
        class="h-7 w-7"
        aria-label="Create a time anchor"
        title="Create a time anchor"
        onclick={() => openAnchorModal(null)}
      >
        <Plus class="h-3.5 w-3.5" />
      </Button>
    </div>
  </div>

  {#if rows.length === 0}
    <p class="text-muted-foreground text-xs">
      Nothing to bound yet. Write an entry, then anchor one you are sure of.
    </p>
  {:else if shown.length === 0}
    <p class="text-muted-foreground text-xs">
      {#if filterAnchors}
        Nothing is anchored yet. A natural boundary resolves to a recorded ending, which is what a
        repair measures from until you assert otherwise.
      {:else}
        Every reference point here is an anchor of your own.
      {/if}
    </p>
  {:else}
    <ul class="space-y-3">
      {#each shown as row (row.boundary.entryId)}
        <li class="text-xs">
          <div class="flex items-center justify-between gap-2">
            <span class="text-foreground font-medium">
              Entry {anchorEntryNumber(row.boundary.entryId)}:
              {row.boundary.time ? stamp(row.boundary.time) : 'no recorded ending'}
            </span>
            <span class="flex shrink-0 items-center gap-1">
              {#if row.anchor}
                <Button
                  variant="text"
                  size="icon"
                  class="h-6 w-6"
                  aria-label="Edit time anchor"
                  title="Edit time anchor"
                  onclick={() => openAnchorModal(row.boundary.entryId)}
                >
                  <Edit class="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="text"
                  size="icon"
                  class="text-destructive h-6 w-6"
                  aria-label="Delete time anchor"
                  title="Delete time anchor"
                  onclick={() => story.removeTimeAnchor(row.boundary.entryId)}
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </Button>
              {:else}
                <Button
                  variant="text"
                  size="icon"
                  class="h-6 w-6"
                  aria-label="Create a time anchor"
                  title="Create a time anchor"
                  onclick={() => openAnchorModal(row.boundary.entryId)}
                >
                  <Anchor class="h-3.5 w-3.5" />
                </Button>
              {/if}
            </span>
          </div>
          <p class="flex flex-wrap items-center gap-1">
            {#if row.anchor}
              <span
                class="rounded bg-amber-500/15 px-1 text-[10px] tracking-wide text-amber-700 uppercase dark:text-amber-500"
              >
                Anchor
              </span>
            {/if}
            {#each row.roles as role (role)}
              <span
                class="bg-muted text-muted-foreground rounded px-1 text-[10px] tracking-wide uppercase"
              >
                {role}
              </span>
            {/each}
            {#if row.checkpoint}
              <span
                class="bg-muted text-muted-foreground rounded px-1 text-[10px] tracking-wide uppercase"
              >
                Checkpoint
              </span>
            {/if}
          </p>
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground flex items-center gap-1"
            aria-expanded={expanded.includes(row.boundary.entryId)}
            onclick={() => toggleTimes(row.boundary.entryId)}
          >
            {#if expanded.includes(row.boundary.entryId)}
              <ChevronDown class="h-3 w-3" />
            {:else}
              <ChevronRight class="h-3 w-3" />
            {/if}
            Asserted: {row.anchor ? 'Yes' : 'No'}
          </button>
          {#if expanded.includes(row.boundary.entryId)}
            <dl class="text-muted-foreground border-border/60 ml-4 border-l pl-2">
              {#if row.anchor}
                <div class="flex justify-between gap-2">
                  <dt>Anchor</dt>
                  <dd>{stamp(row.anchor.assertedTime)}</dd>
                </div>
              {/if}
              {#if row.checkpoint?.timeTrackerSnapshot}
                <div class="flex justify-between gap-2">
                  <dt>Checkpoint</dt>
                  <dd>{stamp(row.checkpoint.timeTrackerSnapshot)}</dd>
                </div>
              {/if}
              <div class="flex justify-between gap-2">
                <dt>Entry end</dt>
                <dd>{row.entryEnd ? stamp(row.entryEnd) : 'none recorded'}</dd>
              </div>
            </dl>
          {/if}
          {#if row.checkpoint}
            <p class="text-muted-foreground">Checkpoint: {row.checkpoint.name}</p>
          {/if}
          <p class="text-muted-foreground">Branch: {row.branch}</p>
          {#if row.anchor?.note}
            <p class="text-muted-foreground italic">{row.anchor.note}</p>
          {/if}
          <button
            type="button"
            class="text-accent-500 hover:text-accent-600 mt-0.5 flex items-center gap-1"
            onclick={() => goToEntry(row.boundary.entryId)}
          >
            <CornerDownLeft class="h-3 w-3" />
            Go to entry
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<!-- Last, not first: reconciling is where this panel leads, once a reference point is in place -->
<Button variant="outline" size="sm" class="mt-3 w-full" onclick={() => (repairOpen = true)}>
  <Wrench class="h-3.5 w-3.5" />
  Reconcile
</Button>

<TimelineRepairModal bind:open={repairOpen} />
<TimelineAnomaliesModal bind:open={anomaliesOpen} />
<TimeAnchorModal bind:open={anchorModalOpen} entryId={anchorModalEntryId} />
