<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import {
    Anchor,
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
  import { entryNumber, jumpToEntry } from '$lib/utils/storyNavigation'
  import { supportsHover } from '$lib/utils/platform'
  import TimelineReconciliationModal from './TimelineReconciliationModal.svelte'
  import TimelineAnomaliesModal from './TimelineAnomaliesModal.svelte'
  import TimeAnchorModal from './TimeAnchorModal.svelte'
  import EntryTimeModal from './EntryTimeModal.svelte'
  import { formatStoryTime, toMinutes } from '$lib/services/storyTime'
  import type { TimeTracker } from '$lib/types'

  let reconcileOpen = $state(false)
  /** Set when the reader arrives from an anomaly, which decides the range opened on. */
  let reconcileEntryId = $state<string | null>(null)
  let anomaliesOpen = $state(false)
  let anchorModalOpen = $state(false)
  /** Null when adding: the modal then asks which entry to anchor. */
  let anchorModalEntryId = $state<string | null>(null)
  let entryTimeOpen = $state(false)
  let entryTimeEntryId = $state<string | null>(null)
  /** Reference points whose recorded times are unfolded. An array, not a Set: runes want one. */
  let expanded = $state<string[]>([])
  // Opt-in: nothing ticked is no filter at all, rather than a filter that hides everything.
  let filterAnchors = $state(false)
  let filterNatural = $state(false)
  let showCheckpoints = $state(false)

  function toggleTimes(entryId: string) {
    expanded = expanded.includes(entryId)
      ? expanded.filter((id) => id !== entryId)
      : [...expanded, entryId]
  }

  function openAnchorModal(entryId: string | null) {
    anchorModalEntryId = entryId
    anchorModalOpen = true
  }

  function openEntryTimeModal(entryId: string) {
    entryTimeEntryId = entryId
    entryTimeOpen = true
  }

  function goToEntry(entryId: string) {
    jumpToEntry({
      entries: story.entries,
      entryId,
      ui,
      confirmation: `Jumped to entry ${anchorEntryNumber(entryId)}`,
      closeOnMobile: () => ui.closeNavPanelOnMobile(),
      canHover: supportsHover(),
    })
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

  function describe(entryId: string, index: number) {
    const entry = story.entries.find((e) => e.id === entryId)
    const checkpoint = story.checkpoints.find((c) => c.lastEntryId === entryId) ?? null
    const isFork = forkEntryIds.has(entryId)
    const anchor = story.timeAnchorFor(entryId) ?? null
    // One moment, read from as many places as have copied it: the entry's own ending, the
    // checkpoint's snapshot, the assertion. A single reading agrees with itself.
    const readings = [
      entry?.metadata?.timeEnd ?? null,
      checkpoint?.timeTrackerSnapshot ?? null,
      anchor?.assertedTime ?? null,
    ].filter((time): time is TimeTracker => time !== null)
    return {
      anchor,
      coherent: readings.every((time) => toMinutes(time) === toMinutes(readings[0])),
      checkpoint,
      /** Only where nothing forked from it: the Fork point chip already says there is one. */
      checkpointChip: !!checkpoint && !isFork,
      // Independent of the anchor: asserting a time does not stop the entry being where the
      // story opens, ends, or forks.
      natural: index === 0 || index === story.entries.length - 1 || isFork,
      entryEnd: entry?.metadata?.timeEnd ?? null,
      roles: [
        index === 0 ? 'Beginning' : null,
        index === story.entries.length - 1 ? 'Current end' : null,
        // Supersedes the checkpoint chip: a fork always has one, and the wall is the branch.
        isFork ? 'Fork point' : null,
      ].filter((role): role is string => role !== null),
      branch: branchName(entry?.branchId ?? null),
    }
  }

  // Boundaries arrive in story order, one per entry. Their roles are read back from the story
  // rather than from `Boundary.kind`, which names only the one that won the tie: an anchored
  // fork point is both, and the list is where that has to show.
  const rows = $derived(
    story.timeBoundaries.map((boundary) => ({
      boundary,
      index: boundary.index,
      entryId: boundary.entryId,
      time: boundary.time,
      ...describe(boundary.entryId, boundary.index),
    })),
  )

  // A checkpoint bounds nothing on its own, so it is listed as context rather than as a point a
  // range can run to. Anchoring one is what makes it a boundary.
  const checkpointRows = $derived.by(() => {
    const bounded = new Set(story.timeBoundaries.map((boundary) => boundary.entryId))
    const rowsForCheckpoints = []
    for (const [index, entry] of story.entries.entries()) {
      if (bounded.has(entry.id)) continue
      if (!story.checkpoints.some((checkpoint) => checkpoint.lastEntryId === entry.id)) continue
      rowsForCheckpoints.push({
        boundary: null,
        index,
        entryId: entry.id,
        time: entry.metadata?.timeEnd ?? null,
        ...describe(entry.id, index),
      })
    }
    return rowsForCheckpoints
  })

  const filtered = $derived(filterAnchors || filterNatural)
  // Either qualifies, so a point that is both stays visible while either box is ticked.
  const shown = $derived.by(() => {
    const points = filtered
      ? rows.filter((row) => (row.anchor && filterAnchors) || (row.natural && filterNatural))
      : rows
    // Adds rather than filters: the checkpoints are not reference points, and the boxes above
    // say which of the reference points to keep.
    if (!showCheckpoints) return points
    return [...points, ...checkpointRows].sort((a, b) => a.index - b.index)
  })

  const report = $derived(story.timelineReport)
  const defects = $derived(report.anomalies.filter((a) => a.severity === 'defect').length)
  const suspected = $derived(report.anomalies.filter((a) => a.severity === 'suspected').length)

  const stamp = formatStoryTime
</script>

<h3 class="text-foreground mb-2 text-xl font-bold tracking-tight">Timeline</h3>

<!-- What the recorded timeline looks like -->
<div class="border-border bg-card rounded-lg border p-3 shadow-sm">
  <dl class="text-xs">
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

<!-- Anchors: the reader's own assertions, and the only thing a reconciliation measures from -->
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
          <!-- Below the line because it is not one of them: the boxes above narrow the reference
               points, this one adds rows that are not reference points at all. -->
          <DropdownMenu.Separator />
          <DropdownMenu.CheckboxItem bind:checked={showCheckpoints} closeOnSelect={false}>
            Show checkpoints
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
        reconciliation measures from until you assert otherwise.
      {:else}
        Every reference point here is an anchor of your own.
      {/if}
    </p>
  {:else}
    <ul class="space-y-3">
      {#each shown as row (row.entryId)}
        <li class="text-xs">
          <div class="flex items-center justify-between gap-2">
            <span class="text-foreground font-medium">
              Entry {anchorEntryNumber(row.entryId)}:
              {row.time ? stamp(row.time) : 'no recorded ending'}
            </span>
            <!-- One control per row. An anchor supersedes what is under it, so its own editor is
                 the only way in; without one, a boundary is edited directly and a checkpoint,
                 which bounds nothing, is offered the anchor that would make it a boundary. -->
            <span class="flex shrink-0 items-center gap-1">
              {#if row.anchor}
                <Button
                  variant="text"
                  size="icon"
                  class="h-6 w-6 text-amber-500 hover:text-amber-600"
                  aria-label="Edit time anchor"
                  title="Edit time anchor"
                  onclick={() => openAnchorModal(row.entryId)}
                >
                  <Anchor class="h-3.5 w-3.5" />
                </Button>
              {:else if row.boundary}
                <Button
                  variant="text"
                  size="icon"
                  class="h-6 w-6"
                  aria-label="Edit the recorded time"
                  title="Edit the recorded time"
                  onclick={() => openEntryTimeModal(row.entryId)}
                >
                  <Edit class="h-3.5 w-3.5" />
                </Button>
              {:else}
                <Button
                  variant="text"
                  size="icon"
                  class="h-6 w-6"
                  aria-label="Create a time anchor"
                  title="Create a time anchor"
                  onclick={() => openAnchorModal(row.entryId)}
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
            <!-- The fork reads as a wall, like the anchor: both are why a range stops here. -->
            {#each row.roles as role (role)}
              <span
                class="rounded px-1 text-[10px] tracking-wide uppercase {role === 'Fork point'
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-500'
                  : 'bg-muted text-muted-foreground'}"
              >
                {role}
              </span>
            {/each}
            {#if row.checkpointChip}
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
            aria-expanded={expanded.includes(row.entryId)}
            onclick={() => toggleTimes(row.entryId)}
          >
            {#if expanded.includes(row.entryId)}
              <ChevronDown class="h-3 w-3" />
            {:else}
              <ChevronRight class="h-3 w-3" />
            {/if}
            Coherence: {row.coherent ? 'Yes' : 'No'}
          </button>
          {#if expanded.includes(row.entryId)}
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
            onclick={() => goToEntry(row.entryId)}
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
<Button
  variant="outline"
  size="sm"
  class="mt-3 w-full"
  onclick={() => {
    reconcileEntryId = null
    reconcileOpen = true
  }}
>
  <Wrench class="h-3.5 w-3.5" />
  Reconcile
</Button>

<TimelineReconciliationModal bind:open={reconcileOpen} focusEntryId={reconcileEntryId} />
<TimelineAnomaliesModal
  bind:open={anomaliesOpen}
  onReconcile={(entryId) => {
    reconcileEntryId = entryId
    reconcileOpen = true
  }}
/>
<TimeAnchorModal bind:open={anchorModalOpen} entryId={anchorModalEntryId} />
{#if entryTimeEntryId}
  <EntryTimeModal bind:open={entryTimeOpen} entryId={entryTimeEntryId} />
{/if}
