<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import {
    Pencil,
    RotateCcw,
    Save,
    Anchor,
    Trash2,
    Wrench,
    ListChecks,
    Plus,
    Pencil as Edit,
    CornerDownLeft,
  } from '@lucide/svelte'
  import TimelineRepairModal from './TimelineRepairModal.svelte'
  import TimelineAnomaliesModal from './TimelineAnomaliesModal.svelte'
  import TimeAnchorModal from './TimeAnchorModal.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { entryNumber } from '$lib/utils/storyNavigation'
  import { supportsHover } from '$lib/utils/platform'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'

  let isEditing = $state(false)
  let editYears = $state(0)
  let editDays = $state(0)
  let editHours = $state(0)
  let editMinutes = $state(0)

  function startEdit() {
    const time = story.timeTracker
    editYears = time.years
    editDays = time.days
    editHours = time.hours
    editMinutes = time.minutes
    isEditing = true
  }

  function cancelEdit() {
    isEditing = false
  }

  async function saveEdit() {
    await story.setTimeTracker({
      years: Math.max(0, Number(editYears) || 0),
      days: Math.max(0, Number(editDays) || 0),
      hours: Math.max(0, Number(editHours) || 0),
      minutes: Math.max(0, Number(editMinutes) || 0),
    })
    isEditing = false
  }

  async function resetTime() {
    const confirmed = await new Promise<boolean>((resolve) => {
      const result = confirm('Reset time to zero? This cannot be undone.')
      resolve(result)
    })
    if (!confirmed) return
    await story.setTimeTracker({ years: 0, days: 0, hours: 0, minutes: 0 })
  }

  // Helper to pad numbers for display
  function pad(n: number, width: number = 2): string {
    return n.toString().padStart(width, '0')
  }

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

  function stamp(time: { years: number; days: number; hours: number; minutes: number }): string {
    return `Y${time.years + 1} D${time.days + 1} ${pad(time.hours)}:${pad(time.minutes)}`
  }
</script>

<div class="flex flex-col gap-1 pb-12">
  <!-- Header -->
  <div class="mb-2 flex items-center justify-between">
    <h3 class="text-foreground text-xl font-bold tracking-tight">Time</h3>
    {#if !isEditing}
      <div class="flex items-center gap-1">
        <Button
          variant="text"
          size="icon"
          class="text-muted-foreground hover:text-foreground h-6 w-6"
          onclick={startEdit}
          title="Edit time"
        >
          <Pencil class="h-4 w-4" />
        </Button>
        <Button
          variant="text"
          size="icon"
          class="text-muted-foreground hover:text-destructive h-6 w-6"
          onclick={resetTime}
          title="Reset time"
        >
          <RotateCcw class="h-4 w-4" />
        </Button>
      </div>
    {/if}
  </div>

  {#if isEditing}
    <div class="border-border bg-card rounded-lg border p-3 shadow-sm">
      <div class="mb-3 grid grid-cols-2 gap-3">
        <div class="space-y-1">
          <Label class="text-xs">Years</Label>
          <Input type="number" bind:value={editYears} min="0" class="h-8 text-sm" />
        </div>
        <div class="space-y-1">
          <Label class="text-xs">Days</Label>
          <Input type="number" bind:value={editDays} min="0" max="364" class="h-8 text-sm" />
        </div>
        <div class="space-y-1">
          <Label class="text-xs">Hours</Label>
          <Input type="number" bind:value={editHours} min="0" max="23" class="h-8 text-sm" />
        </div>
        <div class="space-y-1">
          <Label class="text-xs">Minutes</Label>
          <Input type="number" bind:value={editMinutes} min="0" max="59" class="h-8 text-sm" />
        </div>
      </div>

      <p class="text-muted-foreground mb-3 text-xs">Time will be automatically normalized.</p>

      <div class="border-border flex justify-end gap-2 border-t pt-2">
        <Button variant="text" size="sm" class="h-7 text-xs" onclick={cancelEdit}>Cancel</Button>
        <Button size="sm" class="h-7 px-4 text-xs" onclick={saveEdit}>
          <Save class="h-3.5 w-3.5" />
          Save
        </Button>
      </div>
    </div>
  {:else}
    <div class="group border-border bg-card rounded-lg border p-3 shadow-sm transition-all">
      <!-- Detailed time display -->
      <div class="grid grid-cols-4 gap-2 text-center">
        <div class="bg-muted/50 border-border/50 rounded border p-2">
          <div class="text-foreground text-lg font-medium">
            {story.timeTracker.years}
          </div>
          <div class="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            Years
          </div>
        </div>
        <div class="bg-muted/50 border-border/50 rounded border p-2">
          <div class="text-foreground text-lg font-medium">
            {story.timeTracker.days}
          </div>
          <div class="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            Days
          </div>
        </div>
        <div class="bg-muted/50 border-border/50 rounded border p-2">
          <div class="text-foreground text-lg font-medium">
            {pad(story.timeTracker.hours)}
          </div>
          <div class="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            Hours
          </div>
        </div>
        <div class="bg-muted/50 border-border/50 rounded border p-2">
          <div class="text-foreground text-lg font-medium">
            {pad(story.timeTracker.minutes)}
          </div>
          <div class="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
            Min
          </div>
        </div>
      </div>
    </div>

    <p class="text-muted-foreground mt-2 px-1 text-xs">
      Time is tracked automatically as the story progresses.
    </p>

    <!-- What the recorded timeline looks like, and what has been asserted about it -->
    <div class="border-border bg-card mt-4 rounded-lg border p-3 shadow-sm">
      <div class="mb-2 flex items-center justify-between">
        <h4 class="text-foreground text-sm font-semibold">Timeline</h4>
        <Button
          variant="outline"
          size="sm"
          class="h-7 text-xs"
          onclick={() => (repairOpen = true)}
          disabled={story.timeRanges.length === 0}
        >
          <Wrench class="h-3.5 w-3.5" />
          Reconcile
        </Button>
      </div>

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
              {#if suspected > 0}<span class="text-muted-foreground">{suspected} suspected</span
                >{/if}
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
            <li class="text-xs">
              <div class="flex items-center justify-between gap-2">
                <span class="text-foreground font-medium">
                  Entry {anchorEntryNumber(anchor.entryId)}: {stamp(anchor.assertedTime)}
                </span>
                <span class="flex shrink-0 items-center">
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
  {/if}
</div>

<TimelineRepairModal bind:open={repairOpen} />
<TimelineAnomaliesModal bind:open={anomaliesOpen} />
<TimeAnchorModal bind:open={anchorModalOpen} entryId={anchorModalEntryId} />
