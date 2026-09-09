<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import {
    Anchor,
    Trash2,
    Wrench,
    ListChecks,
    Plus,
    Pencil as Edit,
    CornerDownLeft,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
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

  const anchors = $derived(
    [...story.timeAnchors].sort((a, b) => {
      const order = new Map(story.entries.map((entry, index) => [entry.id, index]))
      return (order.get(a.entryId) ?? 0) - (order.get(b.entryId) ?? 0)
    }),
  )
  const report = $derived(story.timelineReport)
  const defects = $derived(report.anomalies.filter((a) => a.severity === 'defect').length)
  const suspected = $derived(report.anomalies.filter((a) => a.severity === 'suspected').length)
  const notes = $derived(report.anomalies.filter((a) => a.severity === 'note').length)

  function pad(n: number, width: number = 2): string {
    return n.toString().padStart(width, '0')
  }

  function stamp(time: { years: number; days: number; hours: number; minutes: number }): string {
    return `Y${time.years + 1} D${time.days + 1} ${pad(time.hours)}:${pad(time.minutes)}`
  }
</script>

<div class="mb-2 flex items-center justify-between">
  <h3 class="text-foreground text-xl font-bold tracking-tight">Timeline</h3>
  <Button variant="outline" size="sm" class="h-7 text-xs" onclick={() => (repairOpen = true)}>
    <Wrench class="h-3.5 w-3.5" />
    Reconcile
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
        {#if defects === 0 && suspected === 0 && notes === 0}
          none found
        {:else}
          {#if defects > 0}<span class="text-destructive">{defects} definite</span>{/if}
          {#if defects > 0 && (suspected > 0 || notes > 0)}<span>, </span>{/if}
          {#if suspected > 0}<span class="text-muted-foreground">{suspected} suspected</span>{/if}
          {#if suspected > 0 && notes > 0}<span>, </span>{/if}
          {#if notes > 0}<span class="text-muted-foreground">{notes} to decide</span>{/if}
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
    <h4 class="text-foreground flex items-center gap-1 text-sm font-semibold">
      <Anchor class="h-3.5 w-3.5" />
      Anchors
    </h4>
    <Button
      variant="outline"
      size="icon"
      class="h-7 w-7"
      aria-label="Create an anchor"
      title="Create an anchor"
      onclick={() => openAnchorModal(null)}
    >
      <Plus class="h-3.5 w-3.5" />
    </Button>
  </div>

  {#if anchors.length === 0}
    <p class="text-muted-foreground text-xs">
      None yet. Anchor an entry you are sure of, then reconcile the range up to it.
    </p>
  {:else}
    <ul class="space-y-3">
      {#each anchors as anchor (anchor.id)}
        {@const owned = story.ownsEntry(anchor.entryId)}
        <li class="text-xs">
          <div class="flex items-center justify-between gap-2">
            <span class="text-foreground font-medium">
              Entry {anchorEntryNumber(anchor.entryId)}: {stamp(anchor.assertedTime)}
            </span>
            <span class="flex shrink-0 items-center gap-1">
              {#if owned}
                <Button
                  variant="text"
                  size="icon"
                  class="h-6 w-6"
                  aria-label="Edit anchor"
                  title="Edit anchor"
                  onclick={() => openAnchorModal(anchor.entryId)}
                >
                  <Edit class="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="text"
                  size="icon"
                  class="text-destructive h-6 w-6"
                  aria-label="Delete anchor"
                  title="Delete anchor"
                  onclick={() => story.removeTimeAnchor(anchor.entryId)}
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </Button>
              {:else}
                <span
                  class="bg-muted text-muted-foreground rounded px-1 text-[10px] tracking-wide uppercase"
                  title="This anchor belongs to an entry another branch owns. Switch to that branch to change it."
                >
                  Inherited
                </span>
              {/if}
            </span>
          </div>
          {#if anchor.note}
            <p class="text-muted-foreground italic">{anchor.note}</p>
          {/if}
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground mt-0.5 flex items-center gap-1"
            onclick={() => goToEntry(anchor.entryId)}
          >
            <CornerDownLeft class="h-3 w-3" />
            Go to entry
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<TimelineRepairModal bind:open={repairOpen} />
<TimelineAnomaliesModal bind:open={anomaliesOpen} />
<TimeAnchorModal bind:open={anchorModalOpen} entryId={anchorModalEntryId} />
