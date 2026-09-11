<script lang="ts">
  import { story, type TimelineRepairPreview } from '$lib/stores/story.svelte'
  import { timelineLayout } from '$lib/stores/timelineLayout.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import * as Dialog from '$lib/components/ui/dialog'
  import { TriangleAlert, ChevronDown, ChevronRight } from '@lucide/svelte'
  import {
    toMinutes,
    parseDuration,
    formatDuration,
    durationIsInvalid,
    outstandingDurations,
    rangeIntervals,
  } from '$lib/services/storyTime'
  import type { SelectableRange, GapPolicy } from '$lib/services/storyTime'
  import type { StoryEntry, TimeTracker } from '$lib/types'

  let { open = $bindable(false) }: { open?: boolean } = $props()

  let selectedIndex = $state(0)
  /** What the reader typed into each entry's weight field, by entry id. */
  let supplied = $state<Record<string, string>>({})
  /** What to do with each interval, keyed by the entry it follows. A missing key is undecided. */
  let gapPolicies = $state<Record<string, GapPolicy>>({})
  /** The row the control panel acts on: an entry, or the interval after one. */
  let selection = $state<{ kind: 'entry' | 'gap'; entryId: string } | null>(null)
  let applying = $state(false)
  let staleMessage = $state<string | null>(null)
  let appliedMessage = $state<string | null>(null)
  let fullTextOpen = $state(false)
  function isOpen(kind: 'entry' | 'gap', entryId: string): boolean {
    return selection?.kind === kind && selection.entryId === entryId
  }

  /**
   * Selection and expansion are the same thing: the desktop layout draws it in the panel below,
   * the narrow one unfolds it under the row. Tapping the open row closes it again.
   */
  function chooseRow(next: { kind: 'entry' | 'gap'; entryId: string }) {
    selection = isOpen(next.kind, next.entryId) && timelineLayout.mobile ? null : next
  }

  const ranges = $derived(story.timeRanges)
  const range = $derived<SelectableRange | undefined>(ranges[selectedIndex])

  const byId = $derived(new Map(story.entries.map((entry) => [entry.id, entry])))

  /** What the range's entries record for themselves, first beginning to last ending. */
  const recordedSpan = $derived.by(() => {
    const start = range ? byId.get(range.entryIds[0])?.metadata?.timeStart : null
    const end = range ? byId.get(range.to.entryId)?.metadata?.timeEnd : null
    if (!start || !end) return null
    return toMinutes(end) - toMinutes(start)
  })

  /** What the two reference points say it should occupy. The repair is the ratio between them. */
  const assertedSpan = $derived(
    range?.from.time && range?.to.time
      ? toMinutes(range.to.time) - toMinutes(range.from.time)
      : null,
  )

  /** The story's own last entry, which a repair must include before it may move the clock. */
  const lastEntryNumber = $derived.by(() => {
    const last = story.entries[story.entries.length - 1]
    return last ? entryNumber(last.id) : null
  })

  function spanText(minutes: number | null): string {
    if (minutes === null) return 'unreadable'
    return minutes < 0 ? `-${formatDuration(-minutes)}` : formatDuration(minutes)
  }
  const rangeEntries = $derived<StoryEntry[]>(
    range
      ? range.entryIds.map((id) => byId.get(id)).filter((entry): entry is StoryEntry => !!entry)
      : [],
  )

  /** Overrides that currently read as a duration. A half-typed field simply is not one yet. */
  const overrides = $derived.by(() => {
    const parsed: Record<string, number> = {}
    for (const [entryId, text] of Object.entries(supplied)) {
      const minutes = parseDuration(text)
      if (minutes !== null) parsed[entryId] = minutes
    }
    return parsed
  })

  const intervals = $derived(rangeIntervals(rangeEntries).filter((i) => i.recordedMinutes > 0))
  const unreadable = $derived(outstandingDurations(rangeEntries, overrides))
  const undecidedGaps = $derived(
    intervals.filter((interval) => gapPolicies[interval.afterEntryId] === undefined),
  )
  /** Nothing is reconciled until every length is known and every interval decided. */
  const resolved = $derived(unreadable.length === 0 && undecidedGaps.length === 0)

  const refusal = $derived(range ? story.previewTimelineRepair(range, {}, {}) : null)
  const isRefused = $derived(refusal?.status === 'refused')

  const preview = $derived<TimelineRepairPreview | null>(
    range && resolved && !isRefused
      ? story.previewTimelineRepair(range, overrides, gapPolicies)
      : null,
  )

  function pad(n: number): string {
    return String(n ?? 0).padStart(2, '0')
  }

  function stamp(time: TimeTracker | null | undefined): string {
    if (!time) return '—'
    return `Y${time.years + 1} D${time.days + 1} ${pad(time.hours)}:${pad(time.minutes)}`
  }

  function stampRange(start: TimeTracker | null | undefined, end: TimeTracker | null | undefined) {
    if (!start && !end) return 'no time recorded'
    return `${stamp(start)} → ${stamp(end)}`
  }

  /**
   * The weight shown in the Was column, and whether the reader supplied it.
   *
   * Narration only. A player action is an instant, so it has no weight to show — and printing
   * one as zero would read as the collapse warning a narration entry's zero really is.
   */
  function wasWeight(entryId: string): { text: string; supplied: boolean } {
    if (overrides[entryId] !== undefined) {
      return { text: formatDuration(overrides[entryId]), supplied: true }
    }
    const recorded = recordedWeight(entryId)
    return { text: recorded === null ? 'unreadable' : formatDuration(recorded), supplied: false }
  }

  function describeMinutes(total: number): string {
    if (total === 0) return 'none'
    const days = Math.floor(total / 1440)
    const hours = Math.floor((total % 1440) / 60)
    const minutes = total % 60
    return [days ? `${days}d` : '', hours ? `${hours}h` : '', minutes ? `${minutes}m` : '']
      .filter(Boolean)
      .join(' ')
  }

  function entryNumber(entryId: string): number {
    return story.entries.findIndex((entry) => entry.id === entryId) + 1
  }

  function entryText(entryId: string): string {
    return byId.get(entryId)?.content.trim().replace(/\s+/g, ' ') ?? entryId
  }

  function isAction(entryId: string): boolean {
    return byId.get(entryId)?.type === 'user_action'
  }

  function label(entryId: string): string {
    return isAction(entryId) ? 'You' : 'Story'
  }

  function rangeLabel(candidate: SelectableRange): string {
    const ids = candidate.entryIds
    const span = `${stamp(candidate.from.time)} → ${stamp(candidate.to.time)}`
    if (ids.length === 0) return span
    const covered =
      ids.length === 1
        ? `Entry ${entryNumber(ids[0])}`
        : `Entries ${entryNumber(ids[0])}–${entryNumber(ids[ids.length - 1])}`
    // Padded inside the brackets: the app's font all but fuses "(Y".
    return `${covered} ( ${span} )`
  }

  function requestFor(entryId: string) {
    return unreadable.find((request) => request.entryId === entryId)
  }

  function reasonText(reason: string): string {
    if (reason === 'missing-times')
      return 'This entry records no start or end, so its length is unknown.'
    if (reason === 'invalid-override')
      return 'The length you entered is not a whole number of minutes, zero or more.'
    return 'This entry is recorded as ending before it began, so its length cannot be read.'
  }

  function repairedTimes(entryId: string) {
    if (preview?.status !== 'ok') return null
    return preview.result.times.find((time) => time.entryId === entryId) ?? null
  }

  function scaledInterval(afterEntryId: string, beforeEntryId: string): number | null {
    const from = repairedTimes(afterEntryId)
    const to = repairedTimes(beforeEntryId)
    if (!from || !to) return null
    return toMinutes(to.start) - toMinutes(from.end)
  }

  /** What the record alone says the entry lasted, or null when it cannot be read. */
  function recordedWeight(entryId: string): number | null {
    if (isAction(entryId)) return 0
    const entry = byId.get(entryId)
    const start = entry?.metadata?.timeStart
    const end = entry?.metadata?.timeEnd
    if (!start || !end) return null
    const length = toMinutes(end) - toMinutes(start)
    return length < 0 ? null : length
  }

  /** The weight an entry carries after any override, or null while it is still unknown. */
  function weightOf(entryId: string): number | null {
    if (isAction(entryId)) return 0
    if (overrides[entryId] !== undefined) return overrides[entryId]
    if (requestFor(entryId)) return null
    return recordedWeight(entryId)
  }

  /** Entries that had a length and come out with none. A user action never counts: it is an instant. */
  const collapsed = $derived.by(() => {
    if (preview?.status !== 'ok') return [] as string[]
    return preview.result.times
      .filter((time) => toMinutes(time.end) === toMinutes(time.start))
      .map((time) => time.entryId)
      .filter((entryId) => (weightOf(entryId) ?? 0) > 0)
  })

  function gapChoices(interval: {
    afterEntryId: string
    fusePreviousEntryId: string | null
    fuseNextEntryId: string | null
    recordedMinutes: number
  }) {
    const sum = (targetId: string) => {
      const own = weightOf(targetId)
      // The arithmetic is only shown when the target's own length is settled.
      if (own === null) return 'its length is not set yet'
      return `${describeMinutes(own)} + ${describeMinutes(interval.recordedMinutes)}`
    }
    const choices: { value: GapPolicy; label: string; hint: string }[] = [
      {
        value: 'keep',
        label: 'Keep it where it is',
        hint: `weighed as ${describeMinutes(interval.recordedMinutes)}`,
      },
      { value: 'void', label: 'Void it', hint: 'no share; the entries take the span' },
    ]
    if (interval.fusePreviousEntryId) {
      choices.push({
        value: 'fuse-previous',
        label: `Fuse back into entry ${entryNumber(interval.fusePreviousEntryId)}`,
        hint: `that entry weighs ${sum(interval.fusePreviousEntryId)}`,
      })
    }
    if (interval.fuseNextEntryId) {
      choices.push({
        value: 'fuse-next',
        label: `Fuse forward into entry ${entryNumber(interval.fuseNextEntryId)}`,
        hint: `that entry weighs ${sum(interval.fuseNextEntryId)}`,
      })
    }
    return choices
  }

  function clearOverride(entryId: string) {
    const next = { ...supplied }
    delete next[entryId]
    supplied = next
  }

  async function apply() {
    if (preview?.status !== 'ok') return
    applying = true
    staleMessage = null
    appliedMessage = null
    try {
      const outcome = await story.applyTimelineRepair(preview)
      if (outcome === 'stale') {
        staleMessage = 'The story changed while this was open. Review the refreshed figures.'
      } else {
        // Left open on purpose: the repair usually leads to the next range, and the figures
        // below are now the repaired ones. Reconciling again scales by 1 and changes nothing.
        reset()
        appliedMessage = 'Repair applied. The figures below are the repaired timeline.'
      }
    } finally {
      applying = false
    }
  }

  function reset() {
    supplied = {}
    gapPolicies = {}
    selection = null
    staleMessage = null
    appliedMessage = null
    fullTextOpen = false
  }

  $effect(() => {
    void selectedIndex
    reset()
  })

  $effect(() => {
    if (!open) reset()
  })

  const selectedEntry = $derived(
    selection?.kind === 'entry' ? (byId.get(selection.entryId) ?? null) : null,
  )
  const selectedInterval = $derived.by(() => {
    const current = selection
    if (current?.kind !== 'gap') return null
    return intervals.find((i) => i.afterEntryId === current.entryId) ?? null
  })
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="max-w-3xl gap-4 {timelineLayout.mobile ? 'max-h-[90vh] overflow-y-auto' : ''}"
  >
    <Dialog.Header>
      <Dialog.Title>Reconcile a range</Dialog.Title>
      <Dialog.Description>
        Fits the entries between two boundaries to the time they assert, keeping their relative
        pacing. Nothing outside the range is touched.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4">
      {#if ranges.length === 0}
        <p class="text-muted-foreground text-sm">
          There is nothing to reconcile yet. A repair runs between two boundaries, and this story
          offers fewer than two.
        </p>
        <p class="text-muted-foreground text-xs">
          In view: {story.entries.length}
          {story.entries.length === 1 ? 'entry' : 'entries'}, {story.timeAnchors.length}
          {story.timeAnchors.length === 1 ? 'anchor' : 'anchors'}, {story.timeBoundaries.length}
          {story.timeBoundaries.length === 1 ? 'boundary' : 'boundaries'}.
        </p>
      {:else}
        <label class="text-sm">
          Range
          <select
            class="border-input bg-background mt-1 w-full rounded-md border px-2 py-1 text-sm"
            bind:value={selectedIndex}
          >
            {#each ranges as candidate, index (candidate.from.entryId + candidate.to.entryId)}
              <option value={index}>{rangeLabel(candidate)}</option>
            {/each}
          </select>
        </label>

        <div class="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span>Was <span class="text-foreground">{spanText(recordedSpan)}</span></span>
          <span>Becomes <span class="text-foreground">{spanText(assertedSpan)}</span></span>
        </div>

        {#if timelineLayout.mobile}
          <p class="text-muted-foreground text-xs">
            Open a row to set an entry's weight or decide what a time gap is worth.
          </p>
        {/if}

        <!-- Above the table: what the reader still has to settle is the reason to read it. -->
        {#if !resolved}
          <p class="text-muted-foreground flex items-start gap-1 text-xs">
            <TriangleAlert class="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
            <span>
              {#if unreadable.length > 0}
                {unreadable.length}
                {unreadable.length === 1 ? 'entry needs' : 'entries need'} a length{undecidedGaps.length >
                0
                  ? ', '
                  : '. '}
              {/if}
              {#if undecidedGaps.length > 0}
                {undecidedGaps.length} time
                {undecidedGaps.length === 1 ? 'gap needs' : 'gaps need'} a decision.
              {/if}
              Nothing is calculated until each is settled.
            </span>
          </p>
        {/if}

        {#if refusal?.status === 'refused'}
          <div class="border-destructive/50 bg-destructive/10 rounded-md border p-3 text-sm">
            <p class="flex items-center gap-2 font-medium">
              <TriangleAlert class="h-4 w-4" />
              {refusal.refusal.reason === 'backwards-span'
                ? 'These two boundaries contradict each other'
                : 'A boundary has no time'}
            </p>
            <p class="text-muted-foreground mt-1 text-xs">
              {#if refusal.refusal.reason === 'backwards-span'}
                Entry {entryNumber(refusal.refusal.boundaries[0].entryId)} is asserted at
                {stamp(refusal.refusal.boundaries[0].time)}, entry
                {entryNumber(refusal.refusal.boundaries[1].entryId)} at
                {stamp(refusal.refusal.boundaries[1].time)}. The later one asserts an earlier time,
                and only you can say which is wrong.
              {:else}
                {#each refusal.refusal.boundaries as boundary (boundary.entryId)}
                  Entry {entryNumber(boundary.entryId)} has no recorded ending. Pin when it ended to use
                  it as a boundary.
                {/each}
              {/if}
            </p>
          </div>
        {:else}
          <div class={timelineLayout.mobile ? '' : 'max-h-72 overflow-y-auto'}>
            <table class="w-full border-collapse text-xs">
              <thead
                class="text-muted-foreground bg-background border-border sticky top-0 z-10 border-b text-left"
              >
                <tr>
                  <th class="w-8 py-1 pr-2 font-medium">#</th>
                  {#if !timelineLayout.mobile}
                    <th class="w-24 py-1 pr-2 font-medium">Label</th>
                  {/if}
                  <th class="py-1 pr-2 font-medium">Entry</th>
                  <th class="w-36 py-1 pr-2 font-medium">Was</th>
                  <th class="w-36 py-1 font-medium">Becomes</th>
                </tr>
              </thead>
              <tbody>
                {#each rangeEntries as entry (entry.id)}
                  {@const request = requestFor(entry.id)}
                  {@const repaired = repairedTimes(entry.id)}
                  {@const interval = intervals.find((i) => i.afterEntryId === entry.id)}
                  {@const was = wasWeight(entry.id)}
                  <tr
                    class="border-border/50 hover:bg-muted/40 cursor-pointer border-t {selection?.kind ===
                      'entry' && selection.entryId === entry.id
                      ? 'bg-primary/10'
                      : ''}"
                    onclick={() => chooseRow({ kind: 'entry', entryId: entry.id })}
                  >
                    <td class="text-muted-foreground py-1 pr-2 align-top">
                      <span class="flex items-center gap-0.5">
                        {#if timelineLayout.mobile}
                          {#if isOpen('entry', entry.id)}
                            <ChevronDown class="h-3.5 w-3.5 shrink-0" />
                          {:else}
                            <ChevronRight class="h-3.5 w-3.5 shrink-0" />
                          {/if}
                        {/if}
                        {entryNumber(entry.id)}
                      </span>
                    </td>
                    {#if !timelineLayout.mobile}
                      <td class="py-1 pr-2 align-top">
                        <span class="flex items-center gap-1">
                          {#if request}
                            <TriangleAlert class="h-3 w-3 shrink-0 text-amber-600" />
                          {/if}
                          {@render entryChip(entry.id)}
                        </span>
                      </td>
                    {/if}
                    <td class="py-1 pr-2 align-top">
                      <span class="line-clamp-3 {isAction(entry.id) ? 'italic' : ''}">
                        {#if timelineLayout.mobile}
                          {#if request}
                            <TriangleAlert class="mr-1 inline h-3 w-3 text-amber-600" />
                          {/if}
                          {@render entryChip(entry.id)}
                        {/if}
                        {entryText(entry.id)}
                      </span>
                    </td>
                    <td class="text-muted-foreground py-1 pr-2 align-top whitespace-nowrap">
                      <div class="grid grid-cols-[auto_1fr] gap-x-2">
                        {#if isAction(entry.id)}
                          <span>At:</span><span>{stamp(entry.metadata?.timeEnd)}</span>
                        {:else}
                          <span>Start:</span><span>{stamp(entry.metadata?.timeStart)}</span>
                          <span>End:</span><span>{stamp(entry.metadata?.timeEnd)}</span>
                          <span>Weight:</span>
                          <span class={was.supplied ? 'text-foreground font-medium' : ''}>
                            {was.text}
                          </span>
                        {/if}
                      </div>
                    </td>
                    <td class="py-1 align-top whitespace-nowrap">
                      {#if repaired}
                        <div class="grid grid-cols-[auto_1fr] gap-x-2">
                          {#if isAction(entry.id)}
                            <span>At:</span><span>{stamp(repaired.end)}</span>
                          {:else}
                            <span>Start:</span><span>{stamp(repaired.start)}</span>
                            <span>End:</span><span>{stamp(repaired.end)}</span>
                            <span>Weight:</span>
                            <span class="flex items-center gap-1">
                              {#if collapsed.includes(entry.id)}
                                <TriangleAlert class="h-3 w-3 shrink-0 text-amber-600" />
                              {/if}
                              {formatDuration(toMinutes(repaired.end) - toMinutes(repaired.start))}
                            </span>
                          {/if}
                        </div>
                      {:else}
                        <span class="text-muted-foreground">—</span>
                      {/if}
                    </td>
                  </tr>

                  {#if timelineLayout.mobile && isOpen('entry', entry.id)}
                    <tr class="border-border/50 bg-primary/5 border-t">
                      <td colspan="4" class="p-2">{@render controlPanel()}</td>
                    </tr>
                  {/if}

                  {#if interval}
                    {@const decided = gapPolicies[interval.afterEntryId] !== undefined}
                    {@const scaled = scaledInterval(interval.afterEntryId, interval.beforeEntryId)}
                    <tr
                      class="border-border/50 hover:bg-muted/40 cursor-pointer border-t {selection?.kind ===
                        'gap' && selection.entryId === interval.afterEntryId
                        ? 'bg-primary/10'
                        : 'bg-muted/20'}"
                      onclick={() => chooseRow({ kind: 'gap', entryId: interval.afterEntryId })}
                    >
                      <td class="text-muted-foreground py-1 pr-2 align-top">
                        {#if timelineLayout.mobile}
                          {#if isOpen('gap', interval.afterEntryId)}
                            <ChevronDown class="h-3.5 w-3.5 shrink-0" />
                          {:else}
                            <ChevronRight class="h-3.5 w-3.5 shrink-0" />
                          {/if}
                        {/if}
                      </td>
                      {#if !timelineLayout.mobile}
                        <td class="py-1 pr-2 align-top">
                          <span class="flex items-center gap-1">
                            {#if !decided}
                              <TriangleAlert class="h-3 w-3 shrink-0 text-amber-600" />
                            {/if}
                            {@render gapChip()}
                          </span>
                        </td>
                      {/if}
                      <td class="text-muted-foreground py-1 pr-2 align-top">
                        {#if timelineLayout.mobile}
                          {#if !decided}
                            <TriangleAlert class="mr-1 inline h-3 w-3 text-amber-600" />
                          {/if}
                          {@render gapChip()}
                        {/if}
                        Time not claimed by adjacent entries
                      </td>
                      <td class="text-muted-foreground py-1 pr-2 align-top whitespace-nowrap">
                        {describeMinutes(interval.recordedMinutes)}
                      </td>
                      <td class="text-muted-foreground py-1 align-top whitespace-nowrap">
                        {#if scaled === null}
                          —
                        {:else if scaled === 0}
                          closed
                        {:else}
                          {describeMinutes(scaled)}
                        {/if}
                      </td>
                    </tr>

                    {#if timelineLayout.mobile && isOpen('gap', interval.afterEntryId)}
                      <tr class="border-border/50 bg-primary/5 border-t">
                        <td colspan="4" class="p-2">{@render controlPanel()}</td>
                      </tr>
                    {/if}
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>

          {#if !timelineLayout.mobile}
            <!-- A floor rather than a fixed height: it keeps the dialog from jumping as the
                 selection moves between a gap, an entry and nothing at all, without cropping
                 the card's own border when the controls need more room than that. -->
            <div class="flex min-h-56 flex-col">
              {@render controlPanel()}
            </div>
          {/if}

          {#if resolved && preview?.status === 'ok'}
            <div class="text-muted-foreground space-y-1 text-xs">
              {#if preview.result.leadingJoin.differenceMinutes !== 0}
                <p>
                  The entry before this range still ends at
                  {stamp(preview.result.leadingJoin.neighbourTime)}, so it will
                  {preview.result.leadingJoin.differenceMinutes > 0
                    ? 'overlap'
                    : 'leave a gap before'} the new start. Reconcile the range before this one to close
                  it.
                </p>
              {/if}
              {#if preview.result.trailingJoin && preview.result.trailingJoin.differenceMinutes !== 0}
                <p>
                  The entry after this range still begins at
                  {stamp(preview.result.trailingJoin.neighbourTime)}, leaving a break at the end.
                </p>
              {/if}
              {#if preview.plan.clock}
                <p>This range reaches the end of the story, so the current time moves with it.</p>
              {:else}
                <p>
                  The story's current time is unchanged: this repair ends at entry
                  {entryNumber(preview.range.to.entryId)}, and the story ends at entry
                  {lastEntryNumber ?? '?'}. Widen the range to the end of the story to move the
                  clock with it.
                </p>
              {/if}
            </div>

            {#if collapsed.length > 0}
              <p
                class="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs"
              >
                <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                <span>
                  {collapsed.length === 1 ? 'One entry is' : `${collapsed.length} entries are`}
                  compressed to no length, marked above. Their share of the pacing cannot be recovered
                  by widening the range later.
                </span>
              </p>
            {/if}
          {/if}
        {/if}

        {#if staleMessage}
          <p class="text-destructive text-xs">{staleMessage}</p>
        {/if}

        {#if appliedMessage}
          <p class="text-xs text-emerald-600 dark:text-emerald-400">{appliedMessage}</p>
        {/if}
      {/if}
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>
        {appliedMessage ? 'Close' : 'Cancel'}
      </Button>
      <Button disabled={preview?.status !== 'ok' || applying} onclick={apply}>
        {applying ? 'Applying…' : 'Apply repair'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={fullTextOpen}>
  <Dialog.Content class="flex max-h-[90vh] max-w-2xl flex-col gap-4">
    <Dialog.Header>
      <Dialog.Title>
        {selectedEntry ? `Entry ${entryNumber(selectedEntry.id)}` : 'Entry'}
      </Dialog.Title>
    </Dialog.Header>

    <p class="min-h-0 flex-1 overflow-y-auto text-sm whitespace-pre-wrap">
      {selectedEntry?.content ?? ''}
    </p>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (fullTextOpen = false)}>Close</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

{#snippet controlPanel()}
  {#if selectedInterval}
    <div class="border-border rounded-md border p-3 text-xs">
      <p class="mb-2 font-medium">
        Time gap · after entry {entryNumber(selectedInterval.afterEntryId)}
      </p>
      <p class="text-muted-foreground mb-2">
        {describeMinutes(selectedInterval.recordedMinutes)} between entry
        {entryNumber(selectedInterval.afterEntryId)} and entry
        {entryNumber(selectedInterval.beforeEntryId)}, not claimed by either of them.
      </p>
      <div class="flex flex-col gap-1">
        {#each gapChoices(selectedInterval) as choice (choice.value)}
          <label class="flex cursor-pointer items-baseline gap-2">
            <input
              type="radio"
              checked={gapPolicies[selectedInterval.afterEntryId] === choice.value}
              onchange={() => (gapPolicies[selectedInterval.afterEntryId] = choice.value)}
            />
            <span>
              {choice.label}
              <span class="text-muted-foreground">— {choice.hint}</span>
            </span>
          </label>
        {/each}
      </div>
    </div>
  {:else if selectedEntry}
    {@const request = requestFor(selectedEntry.id)}
    <div class="border-border rounded-md border p-3 text-xs">
      <p class="mb-2 flex items-center gap-2 font-medium">
        <span
          class="rounded px-1 text-[10px] tracking-wide uppercase {isAction(selectedEntry.id)
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary/10 text-primary'}"
        >
          {label(selectedEntry.id)}
        </span>
        Entry {entryNumber(selectedEntry.id)}
      </p>
      <Button
        variant="outline"
        size="sm"
        class="mb-2 h-7 text-xs"
        onclick={() => (fullTextOpen = true)}
      >
        Show full text
      </Button>

      {#if request}
        <p class="mb-2 flex items-start gap-1 text-amber-700 dark:text-amber-500">
          <TriangleAlert class="mt-0.5 h-3 w-3 shrink-0" />
          <span>{reasonText(request.reason)}</span>
        </p>
      {/if}

      {#if isAction(selectedEntry.id)}
        <p class="text-muted-foreground">
          An action is an instant — the clock advances while the story responds, not while you
          decide. It weighs nothing and takes no length.
        </p>
      {:else}
        <div class="text-muted-foreground mb-2 flex flex-wrap gap-x-6 gap-y-1">
          <span>
            Recorded
            <span class="text-foreground">
              {stampRange(selectedEntry.metadata?.timeStart, selectedEntry.metadata?.timeEnd)}
            </span>
          </span>
          <span>
            Originally weighed as
            <span class="text-foreground">
              {recordedWeight(selectedEntry.id) === null
                ? 'unreadable'
                : formatDuration(recordedWeight(selectedEntry.id) ?? 0)}
            </span>
          </span>
          <span>
            Custom weight set as
            <span class="text-foreground">
              {overrides[selectedEntry.id] === undefined
                ? 'not set'
                : formatDuration(overrides[selectedEntry.id])}
            </span>
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-2">
            <span class="text-muted-foreground shrink-0">Set custom weight</span>
            <Input
              placeholder="e.g. 90, 2h 30m, 3d"
              class="h-7 w-48 text-xs"
              bind:value={supplied[selectedEntry.id]}
            />
          </label>
          <span class="text-muted-foreground">
            {#if overrides[selectedEntry.id] !== undefined}
              = {formatDuration(overrides[selectedEntry.id])}
            {:else}
              minutes, or units: y d h m
            {/if}
          </span>
          {#if supplied[selectedEntry.id]}
            <Button
              variant="text"
              size="sm"
              class="h-7 text-xs"
              onclick={() => clearOverride(selectedEntry.id)}
            >
              Clear
            </Button>
          {/if}
        </div>
        {#if durationIsInvalid(supplied[selectedEntry.id])}
          <p class="text-destructive mt-1">
            Not a duration. Try a number of minutes, or units like 2h 30m.
          </p>
        {/if}
        <p class="text-muted-foreground mt-2">
          This sets what the entry is <em>worth</em>, not the length it ends up with: the range is
          fitted to its boundaries, so each entry takes a share in proportion to its weight.
        </p>
      {/if}
    </div>
  {:else}
    <p class="text-muted-foreground m-auto text-xs">
      Select a row to set an entry's weight or decide what a time gap is worth.
    </p>
  {/if}
{/snippet}

{#snippet entryChip(entryId: string)}
  <span
    class="rounded px-1 text-[10px] tracking-wide uppercase {isAction(entryId)
      ? 'bg-muted text-muted-foreground'
      : 'bg-primary/10 text-primary'}"
  >
    {label(entryId)}
  </span>
{/snippet}

{#snippet gapChip()}
  <span
    class="rounded bg-amber-500/15 px-1 text-[10px] tracking-wide text-amber-700 uppercase dark:text-amber-500"
  >
    Time gap
  </span>
{/snippet}
