<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import { TriangleAlert, Info, CornerDownLeft, Clock } from '@lucide/svelte'
  import { formatStoryTime } from '$lib/services/storyTime'
  import type { TimelineAnomaly } from '$lib/services/storyTime'
  import { entryNumber } from '$lib/utils/storyNavigation'
  import { supportsHover } from '$lib/utils/platform'
  import type { StoryEntry } from '$lib/types'

  let { open = $bindable(false) }: { open?: boolean } = $props()

  let hideSuspected = $state(false)

  const byId = $derived(new Map(story.entries.map((entry) => [entry.id, entry])))
  const all = $derived(story.timelineReport.anomalies)
  const shown = $derived(
    hideSuspected ? all.filter((anomaly) => anomaly.severity !== 'suspected') : all,
  )

  /**
   * In story order, since the list reads as a walk through the timeline rather than a ranking.
   * An anomaly's subject is its first entry: the later of a pair, the first of a run.
   */
  const ordered = $derived.by(() => {
    const position = new Map(story.entries.map((entry, index) => [entry.id, index]))
    return [...shown].sort(
      (a, b) => (position.get(subjectId(a)) ?? 0) - (position.get(subjectId(b)) ?? 0),
    )
  })

  const suspectedCount = $derived(all.filter((a) => a.severity === 'suspected').length)

  /**
   * An anomaly on an inherited entry can be repaired from here, but that entry is one row every
   * branch descending through it reads, so the repair lands on all of them.
   */
  const sharedCount = $derived(all.filter((anomaly) => !story.ownsEntry(subjectId(anomaly))).length)

  /**
   * The entry a card is about.
   *
   * A pair anomaly lists its two entries in story order, and which of them the wording accuses
   * depends on the kind: a gap lies after the first, while an entry that runs backwards or
   * overlaps is the second. Reading `entryIds[0]` for every kind points the card at the
   * innocent neighbour.
   */
  function subjectId(anomaly: TimelineAnomaly): string {
    const accusesSecond = anomaly.kind === 'backwards' || anomaly.kind === 'overlap'
    return (accusesSecond ? anomaly.entryIds[1] : anomaly.entryIds[0]) ?? anomaly.entryIds[0]
  }

  function subject(anomaly: TimelineAnomaly): StoryEntry | undefined {
    return byId.get(subjectId(anomaly))
  }

  function heading(anomaly: TimelineAnomaly): string {
    const entries = anomaly.entryIds.map((id) => byId.get(id)).filter(Boolean) as StoryEntry[]
    if (entries.length === 0) return 'Unknown entry'
    if (anomaly.kind === 'gap') return `After entry ${entryNumber(entries[0])}`
    if (anomaly.kind === 'flatline' && entries.length > 1) {
      return `Entries ${entryNumber(entries[0])}–${entryNumber(entries[entries.length - 1])}`
    }
    const entry = subject(anomaly)
    return entry ? `Entry ${entryNumber(entry)}` : `Entry ${entryNumber(entries[0])}`
  }

  function marker(anomaly: TimelineAnomaly): { text: string; class: string } {
    if (anomaly.kind === 'gap') {
      return {
        text: 'Time gap',
        class: 'bg-amber-500/15 text-amber-700 dark:text-amber-500',
      }
    }
    const entry = subject(anomaly)
    if (entry?.type === 'user_action')
      return { text: 'You', class: 'bg-muted text-muted-foreground' }
    return { text: 'Story', class: 'bg-primary/10 text-primary' }
  }

  function recorded(anomaly: TimelineAnomaly): string {
    const entry = subject(anomaly)
    const start = entry?.metadata?.timeStart
    const end = entry?.metadata?.timeEnd
    if (!start && !end) return 'no time recorded'
    if (start && end) {
      const same = formatStoryTime(start) === formatStoryTime(end)
      return same ? formatStoryTime(start) : `${formatStoryTime(start)} → ${formatStoryTime(end)}`
    }
    return formatStoryTime(start ?? end!)
  }

  function excerpt(anomaly: TimelineAnomaly): string {
    const entry = subject(anomaly)
    if (!entry) return ''
    return entry.content.trim().replace(/\s+/g, ' ')
  }

  function goTo(anomaly: TimelineAnomaly) {
    const entry = subject(anomaly)
    if (!entry) return
    ui.requestEntryScroll(entry.id)
    ui.setActivePanel('story')
    ui.closeNavPanelOnMobile()
    open = false
    if (!supportsHover()) ui.showToast(`Jumped to entry ${entryNumber(entry)}`, 'info', 2000)
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-2xl gap-4">
    <Dialog.Header>
      <Dialog.Title>Timeline anomalies</Dialog.Title>
      <Dialog.Description>
        What the recorded chronology says that does not hold together. Anchor a point you are sure
        of, then reconcile the range around it.
      </Dialog.Description>
    </Dialog.Header>

    {#if sharedCount > 0}
      <p class="text-muted-foreground text-xs">
        {sharedCount} of these
        {sharedCount === 1 ? 'sits' : 'sit'} in history shared with other branches. {sharedCount ===
        1
          ? 'It'
          : 'They'} can be repaired from here, and the repair will be seen by every branch reading those
        entries.
      </p>
    {/if}

    {#if suspectedCount > 0}
      <label class="flex items-center gap-2 text-xs">
        <input type="checkbox" bind:checked={hideSuspected} />
        Hide suspected ({suspectedCount})
      </label>
    {/if}

    <div class="max-h-[26rem] space-y-2 overflow-y-auto">
      {#if ordered.length === 0}
        <p class="text-muted-foreground py-6 text-center text-sm">
          {all.length === 0 ? 'Nothing looks wrong with this timeline.' : 'Nothing left to show.'}
        </p>
      {/if}

      {#each ordered as anomaly (anomaly.kind + anomaly.entryIds.join())}
        {@const badge = marker(anomaly)}
        <div class="border-border rounded-md border p-3 text-xs">
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <span class="rounded px-1 text-[10px] tracking-wide uppercase {badge.class}">
              {badge.text}
            </span>
            <span class="text-foreground font-semibold">{heading(anomaly)}</span>
            <span class="text-muted-foreground">{recorded(anomaly)}</span>
            {#if !story.ownsEntry(subjectId(anomaly))}
              <span
                class="bg-muted text-muted-foreground rounded px-1 text-[10px] tracking-wide uppercase"
                title="This entry is shared with other branches. Repairing it here repairs it for all of them."
              >
                Shared
              </span>
            {/if}
          </div>

          {#if excerpt(anomaly)}
            <blockquote
              class="border-border text-foreground/80 mb-2 line-clamp-2 border-l-2 pl-2 italic"
            >
              {excerpt(anomaly)}
            </blockquote>
          {/if}

          <p
            class="mb-2 flex items-start gap-1 {anomaly.severity === 'defect'
              ? 'text-destructive'
              : 'text-muted-foreground'}"
          >
            {#if anomaly.severity === 'defect'}
              <TriangleAlert class="mt-0.5 h-3 w-3 shrink-0" />
            {:else if anomaly.severity === 'note'}
              <Clock class="mt-0.5 h-3 w-3 shrink-0" />
            {:else}
              <Info class="mt-0.5 h-3 w-3 shrink-0" />
            {/if}
            <span>{anomaly.detail}</span>
          </p>

          <Button variant="outline" size="sm" class="h-7 text-xs" onclick={() => goTo(anomaly)}>
            <CornerDownLeft class="h-3 w-3" />
            Go to entry
          </Button>
        </div>
      {/each}
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>Close</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
