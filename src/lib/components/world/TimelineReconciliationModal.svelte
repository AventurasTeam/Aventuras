<script lang="ts">
  import { story, type TimelineReconciliationPreview } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import * as Dialog from '$lib/components/ui/dialog'
  import { X } from '@lucide/svelte'
  import { createIsMobile } from '$lib/hooks/is-mobile.svelte'
  import { swipe } from '$lib/utils/swipe'
  import { tick, untrack, type Snippet } from 'svelte'
  import {
    TriangleAlert,
    Anchor,
    GitBranch,
    ChevronDown,
    ChevronRight,
    ChevronLeft,
    Pencil,
    Plus,
  } from '@lucide/svelte'
  import { Textarea } from '$lib/components/ui/textarea'
  import { entryNumber as numberOfEntry } from '$lib/utils/storyNavigation'
  import {
    toMinutes,
    parseStoryTime,
    formatStoryTime,
    storyTimeIsInvalid,
    parseDuration,
    formatDuration,
    durationIsInvalid,
    outstandingDurations,
    rangeIntervals,
    refuseRange,
  } from '$lib/services/storyTime'
  import type {
    SelectableRange,
    RangeInterval,
    RangeRefusal,
    Boundary,
  } from '$lib/services/storyTime'
  import type { StoryEntry, TimeTracker } from '$lib/types'

  let {
    open = $bindable(false),
    /** Opens on the range holding this entry, for a reader arriving from a particular anomaly. */
    focusEntryId = null,
  }: { open?: boolean; focusEntryId?: string | null } = $props()

  const isMobile = createIsMobile()
  /** The ladder on a narrow screen, the table otherwise. */
  const narrow = $derived(isMobile.current)

  let selectedIndex = $state(0)
  /** What the reader typed into each entry's weight field, by entry id. */
  let supplied = $state<Record<string, string>>({})
  /** Table rows opened onto their controls, as `entry:<id>` / `gap:<id>`. Any number at once. */
  let openRows = $state<string[]>([])
  let applying = $state(false)
  let staleMessage = $state<string | null>(null)
  /** A write that threw, which is a different thing from a reconciliation the story moved out from under. */
  let errorMessage = $state<string | null>(null)
  let appliedMessage = $state<string | null>(null)
  /** The entry whose whole text is being read. Full text is only ever its own surface. */
  let fullTextId = $state<string | null>(null)
  /** Ladder cards the reader has unfolded, by card key. */
  let unfolded = $state<Record<string, boolean>>({})
  /**
   * Entries folded away. A band is folded while every entry in it is, so a fold survives the band
   * splitting or merging.
   */
  let folded = $state<Record<string, boolean>>({})
  /** Height of the table view's pinned bands: the picker, then the band the header rests under. */
  let pickerHeight = $state(0)
  let pinnedHeight = $state(0)
  /** The ladder's scroll container, which is also where focus is parked. */
  let ladderEl = $state<HTMLDivElement | null>(null)

  let fullTextBack = $state<HTMLButtonElement | null>(null)
  let fullTextTrigger: HTMLElement | null = null

  /** Park focus here before removing whatever holds it, so nothing else chooses where it lands. */
  function holdFocus() {
    ladderEl?.focus({ preventScroll: true })
  }

  async function showFullText(entryId: string, trigger: HTMLElement) {
    fullTextTrigger = trigger
    fullTextId = entryId
    await tick()
    fullTextBack?.focus({ preventScroll: true })
  }

  async function closeFullText() {
    fullTextId = null
    await tick()
    if (fullTextTrigger?.isConnected) fullTextTrigger.focus({ preventScroll: true })
    else holdFocus()
    fullTextTrigger = null
  }

  const ranges = $derived(story.timeRanges)

  // Opens on the story's end. A reader notices the clock has drifted while it is still drifting,
  // and reconciles the range they are living in; walking the whole story is a once-per-story
  // event. Only on opening, so that applying does not drag the selection back off the range
  // the reader moved to.
  let wasOpen = false
  $effect(() => {
    if (open === wasOpen) return
    wasOpen = open
    if (!open) return
    const list = untrack(() => ranges)
    const asked = untrack(() => focusEntryId)
    const holding = asked ? list.findIndex((candidate) => candidate.entryIds.includes(asked)) : -1
    selectedIndex = holding === -1 ? Math.max(0, list.length - 1) : holding
  })
  const range = $derived<SelectableRange | undefined>(ranges[selectedIndex])
  const hasNextRange = $derived(selectedIndex + 1 < ranges.length)

  function goToNextRange() {
    holdFocus()
    selectedIndex += 1
  }

  const byId = $derived(new Map(story.entries.map((entry) => [entry.id, entry])))
  const anchorsInView = $derived(story.timeAnchors.filter((a) => byId.has(a.entryId)).length)

  const ANCHOR_NOTE_LIMIT = 140
  /** Which of the range's two boundaries is open for editing, and as what. */
  let editing = $state<'from' | 'to' | null>(null)
  let editingKind = $state<'anchor' | 'entry'>('anchor')
  let anchorTimeText = $state('')
  let anchorNote = $state('')
  let entryStartText = $state('')
  let entryEndText = $state('')
  let anchorSaving = $state(false)
  const anchorTime = $derived(parseStoryTime(anchorTimeText))
  const entryStart = $derived(parseStoryTime(entryStartText))
  const entryEnd = $derived(parseStoryTime(entryEndText))
  const entryBackwards = $derived(
    !!entryStart && !!entryEnd && toMinutes(entryEnd) < toMinutes(entryStart),
  )

  function boundaryOf(which: 'from' | 'to'): Boundary | undefined {
    return which === 'from' ? range?.from : range?.to
  }

  /** An anchor asserts an ending, and a player action has none. */
  function anchorable(which: 'from' | 'to'): boolean {
    const boundary = boundaryOf(which)
    return !!boundary && byId.get(boundary.entryId)?.type !== 'user_action'
  }

  function editAnchor(which: 'from' | 'to') {
    const boundary = boundaryOf(which)
    if (!boundary) return
    const anchor = story.timeAnchorFor(boundary.entryId)
    const seed = anchor?.assertedTime ?? byId.get(boundary.entryId)?.metadata?.timeEnd ?? null
    anchorTimeText = seed ? formatStoryTime(seed) : ''
    anchorNote = anchor?.note ?? ''
    editingKind = 'anchor'
    editing = which
  }

  function editEntryTime(which: 'from' | 'to') {
    const boundary = boundaryOf(which)
    if (!boundary) return
    const metadata = byId.get(boundary.entryId)?.metadata
    entryStartText = metadata?.timeStart ? formatStoryTime(metadata.timeStart) : ''
    entryEndText = metadata?.timeEnd ? formatStoryTime(metadata.timeEnd) : ''
    editingKind = 'entry'
    editing = which
  }

  function closeAnchorEditor() {
    holdFocus()
    editing = null
  }

  // An open editor belongs to the boundary it was opened on, not to whatever is selected now.
  let editorRangeKey = ''
  $effect(() => {
    const key = range ? `${range.from.entryId}:${range.to.entryId}` : ''
    if (key === editorRangeKey) return
    editorRangeKey = key
    untrack(() => closeAnchorEditor())
  })

  async function saveEntryTime() {
    const boundary = editing ? boundaryOf(editing) : undefined
    if (!boundary || !entryStart || !entryEnd) return
    anchorSaving = true
    try {
      await story.setEntryTimes(boundary.entryId, entryStart, entryEnd)
      closeAnchorEditor()
    } catch (error) {
      ui.showToast(error instanceof Error ? error.message : 'The time could not be saved', 'error')
    } finally {
      anchorSaving = false
    }
  }

  async function saveAnchor() {
    const boundary = editing ? boundaryOf(editing) : undefined
    if (!boundary || !anchorTime) return
    anchorSaving = true
    try {
      await story.setTimeAnchor(boundary.entryId, anchorTime, anchorNote.trim() || null)
      closeAnchorEditor()
    } catch (error) {
      ui.showToast(
        error instanceof Error ? error.message : 'The anchor could not be saved',
        'error',
      )
    } finally {
      anchorSaving = false
    }
  }

  /** What the range's entries record for themselves, first beginning to last ending. */
  const recordedSpan = $derived.by(() => {
    const start = range ? byId.get(range.entryIds[0])?.metadata?.timeStart : null
    const end = range ? byId.get(range.to.entryId)?.metadata?.timeEnd : null
    if (!start || !end) return null
    return toMinutes(end) - toMinutes(start)
  })

  /** What the two reference points say it should occupy. The reconciliation is the ratio between them. */
  const assertedSpan = $derived(
    range?.from.time && range?.to.time
      ? toMinutes(range.to.time) - toMinutes(range.from.time)
      : null,
  )

  /** The story's own last entry, which a range must include before it may move the clock. */
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

  /** Interval lengths the reader has typed, keyed by the entry each follows. */
  let gapWeights = $state<Record<string, string>>({})
  /** Intervals the reader created. Listed even while empty, or there is nothing to type into. */
  let addedGapIds = $state<string[]>([])

  const statedWeights = $derived.by(() => {
    const parsed: Record<string, number> = {}
    for (const [entryId, text] of Object.entries(gapWeights)) {
      const minutes = parseDuration(text)
      if (minutes !== null) parsed[entryId] = minutes
    }
    return parsed
  })

  // Listed while the record holds one, or the reader is involved with it. Weighing nothing is
  // not the same as not existing: an interval the reader zeroed has to stay visible to be undone.
  /** What the record holds for each interval, before anything the reader has stated. */
  const recordedIntervals = $derived(rangeIntervals(rangeEntries))

  function originalGapMinutes(entryId: string): number {
    return recordedIntervals.find((i) => i.afterEntryId === entryId)?.recordedMinutes ?? 0
  }

  const intervals = $derived(
    rangeIntervals(rangeEntries, statedWeights).filter(
      (i) =>
        i.recordedMinutes > 0 ||
        addedGapIds.includes(i.afterEntryId) ||
        gapWeights[i.afterEntryId] !== undefined,
    ),
  )

  /** An entry can be given an interval when nothing already follows it inside the range. */
  function canAddGap(entryId: string): boolean {
    // Not after a player action: the clock advances during the narration answering it, so there
    // is no time between the two for the reader to claim. It is why a fuse steps over one too.
    if (isAction(entryId)) return false
    if (addedGapIds.includes(entryId)) return false
    if (rangeEntries[rangeEntries.length - 1]?.id === entryId) return false
    return !intervals.some((i) => i.afterEntryId === entryId)
  }

  function addGap(entryId: string) {
    holdFocus()
    addedGapIds = [...addedGapIds, entryId]
    gapWeights = { ...gapWeights, [entryId]: '' }
    // The new row opens with its weight already asking, which is the decision that made it.
    openRows = [...openRows, rowKey('gap', entryId)]
    unfolded = { ...unfolded, [`wg:${entryId}`]: true }
  }

  function removeGap(entryId: string) {
    holdFocus()
    addedGapIds = addedGapIds.filter((id) => id !== entryId)
    const { [entryId]: _weight, ...weights } = gapWeights
    gapWeights = weights
    openRows = openRows.filter((key) => key !== rowKey('gap', entryId))
  }

  function setGapWeight(entryId: string, text: string) {
    gapWeights = { ...gapWeights, [entryId]: text }
  }
  const unreadable = $derived(outstandingDurations(rangeEntries, overrides))
  /**
   * Nothing is reconciled until every length is known. An interval needs no decision: left
   * alone it keeps its recorded length and takes its share like any other weight.
   */
  const invalidWeights = $derived(
    Object.values(supplied).some(durationIsInvalid) ||
      Object.values(gapWeights).some(durationIsInvalid),
  )
  const resolved = $derived(unreadable.length === 0 && !invalidWeights)

  const refusal = $derived(range ? refuseRange(range.from, range.to) : null)
  const isRefused = $derived(!!refusal)

  const preview = $derived<TimelineReconciliationPreview | null>(
    range && resolved && !isRefused
      ? story.previewReconciliation(range, overrides, statedWeights)
      : null,
  )

  /** What the record holds for an entry, as one instant or a span. */
  function recordedText(entry: StoryEntry): string {
    const start = recordedStart(entry)
    const end = entry.metadata?.timeEnd ?? null
    if (!start && !end) return 'no time recorded'
    if (!start || !end || sameInstant(start, end)) return stamp(start ?? end)
    return `${stamp(start)} → ${stamp(end)}`
  }

  function stamp(time: TimeTracker | null | undefined): string {
    return time ? formatStoryTime(time) : '—'
  }

  /** A stamp split where the ladder dims it: year, day, clock. */
  function stampParts(time: TimeTracker | null | undefined): string[] {
    return time ? formatStoryTime(time).split(' ') : ['—']
  }

  function stampRange(start: TimeTracker | null | undefined, end: TimeTracker | null | undefined) {
    if (!start && !end) return 'no time recorded'
    return `${stamp(start)} → ${stamp(end)}`
  }

  /**
   * The weight shown against the reconciled one, and whether the reader supplied it.
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
    return total === 0 ? 'none' : formatDuration(total)
  }

  function entryNumber(entryId: string): number {
    const entry = byId.get(entryId)
    return entry ? numberOfEntry(entry) : 0
  }

  function entryText(entryId: string): string {
    return byId.get(entryId)?.content.trim().replace(/\s+/g, ' ') ?? entryId
  }

  function isAction(entryId: string): boolean {
    return byId.get(entryId)?.type === 'user_action'
  }

  /** The chapter cards' words for the same two kinds. */
  function label(entryId: string): string {
    return isAction(entryId) ? 'Action' : 'Narrative'
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

  function reconciledTimes(entryId: string) {
    if (preview?.status !== 'ok') return null
    return preview.result.times.find((time) => time.entryId === entryId) ?? null
  }

  function scaledInterval(afterEntryId: string, beforeEntryId: string): number | null {
    const from = reconciledTimes(afterEntryId)
    const to = reconciledTimes(beforeEntryId)
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

  function clearOverride(entryId: string) {
    holdFocus()
    const next = { ...supplied }
    delete next[entryId]
    supplied = next
  }

  async function apply() {
    if (preview?.status !== 'ok' || applying) return
    holdFocus()
    applying = true
    staleMessage = null
    errorMessage = null
    appliedMessage = null
    try {
      const outcome = await story.applyReconciliation(preview)
      if (outcome === 'stale') {
        staleMessage = 'The story changed while this was open. Review the refreshed figures.'
      } else {
        // Left open on purpose: this usually leads to the next range, and the figures below
        // are now the reconciled ones. Reconciling again scales by 1 and changes nothing.
        resetInputs()
        appliedMessage = 'Reconciled. The figures below are the new timeline.'
      }
    } catch {
      errorMessage = 'The changes could not be applied. Review the timeline and try again.'
    } finally {
      applying = false
    }
  }

  /** Clears what the reader typed. What they folded is their reading, and outlives a reconciliation. */
  function resetInputs() {
    supplied = {}
    gapWeights = {}
    addedGapIds = []
    errorMessage = null
    staleMessage = null
    appliedMessage = null
    fullTextId = null
  }

  function reset() {
    resetInputs()
    openRows = []
    unfolded = {}
    folded = {}
  }

  $effect(() => {
    void selectedIndex
    reset()
  })

  $effect(() => {
    if (!open) reset()
  })

  const fullTextEntry = $derived(fullTextId ? (byId.get(fullTextId) ?? null) : null)

  function rowKey(kind: 'entry' | 'gap', entryId: string): string {
    return `${kind}:${entryId}`
  }

  function isOpen(kind: 'entry' | 'gap', entryId: string): boolean {
    return openRows.includes(rowKey(kind, entryId))
  }

  /** The table unfolds its controls under the row. Choosing the open row closes it again. */
  function chooseRow(kind: 'entry' | 'gap', entryId: string) {
    const key = rowKey(kind, entryId)
    openRows = openRows.includes(key) ? openRows.filter((open) => open !== key) : [...openRows, key]
  }

  // A band is the space between two rungs, and a rung is earned by the clock moving: everything
  // sharing a start time shares a band. An interval always takes a band of its own.

  type Band =
    | { kind: 'entries'; id: string; entries: StoryEntry[] }
    | { kind: 'interval'; id: string; interval: RangeInterval }

  const bands = $derived.by(() => {
    const built: Band[] = []
    let current: StoryEntry[] = []
    for (const entry of rangeEntries) {
      current.push(entry)
      const interval = intervals.find((i) => i.afterEntryId === entry.id)
      if (interval || timeMoved(current[0], entry)) {
        built.push({ kind: 'entries', id: current[0].id, entries: current })
        current = []
      }
      if (interval) {
        built.push({ kind: 'interval', id: `gap:${interval.afterEntryId}`, interval })
      }
    }
    if (current.length > 0) built.push({ kind: 'entries', id: current[0].id, entries: current })
    return built
  })

  /** Two readings of one instant. A missing time cannot be shown to be either. */
  function sameInstant(
    a: TimeTracker | null | undefined,
    b: TimeTracker | null | undefined,
  ): boolean {
    return !!a && !!b && toMinutes(a) === toMinutes(b)
  }

  /** Whether the clock moved across a run of entries, on either rail. Nothing else earns a rung. */
  function timeMoved(first: StoryEntry, last: StoryEntry): boolean {
    const reconciledFrom = reconciledTimes(first.id)?.start
    const reconciledTo = reconciledTimes(last.id)?.end
    if (reconciledFrom && reconciledTo && !sameInstant(reconciledFrom, reconciledTo)) return true
    return !sameInstant(recordedStart(first), last.metadata?.timeEnd)
  }

  function recordedStart(entry: StoryEntry): TimeTracker | null {
    const metadata = entry.metadata
    return (entry.type === 'user_action' ? metadata?.timeEnd : metadata?.timeStart) ?? null
  }

  interface BandEdges {
    recorded: [TimeTracker | null, TimeTracker | null]
    reconciled: [TimeTracker | null, TimeTracker | null]
  }

  function bandEdges(band: Band): BandEdges {
    if (band.kind === 'entries') {
      const first = band.entries[0]
      const last = band.entries[band.entries.length - 1]
      return {
        recorded: [recordedStart(first), last.metadata?.timeEnd ?? null],
        reconciled: [
          reconciledTimes(first.id)?.start ?? null,
          reconciledTimes(last.id)?.end ?? null,
        ],
      }
    }
    const after = byId.get(band.interval.afterEntryId)
    const before = byId.get(band.interval.beforeEntryId)
    return {
      recorded: [after?.metadata?.timeEnd ?? null, before ? recordedStart(before) : null],
      reconciled: [
        reconciledTimes(band.interval.afterEntryId)?.end ?? null,
        reconciledTimes(band.interval.beforeEntryId)?.start ?? null,
      ],
    }
  }

  /** One more rung than there are bands: bands are contiguous, so each rung serves two. */
  const rungs = $derived.by(() => {
    if (bands.length === 0) return []
    const first = bandEdges(bands[0])
    return [
      { recorded: first.recorded[0], reconciled: first.reconciled[0] },
      ...bands.map((band) => {
        const edges = bandEdges(band)
        return { recorded: edges.recorded[1], reconciled: edges.reconciled[1] }
      }),
    ]
  })

  function bandLength(band: Band): number | null {
    const { reconciled } = bandEdges(band)
    if (!reconciled[0] || !reconciled[1]) return null
    return toMinutes(reconciled[1]) - toMinutes(reconciled[0])
  }

  function bandUnsettled(band: Band): boolean {
    return band.kind === 'entries' && band.entries.some((entry) => !!requestFor(entry.id))
  }

  type LadderRow =
    | { kind: 'rung'; key: string; index: number }
    | { kind: 'summary'; key: string; bandId: string; band: Band }
    | { kind: 'entry'; key: string; bandId: string; entry: StoryEntry }
    | { kind: 'weight'; key: string; bandId: string; entryId: string }
    | { kind: 'interval'; key: string; bandId: string; interval: RangeInterval }
    | { kind: 'gapWeight'; key: string; bandId: string; interval: RangeInterval }

  /** Flat, keyed by entry rather than by band: a band splitting must not unmount a field in use. */
  const ladderRows = $derived.by(() => {
    const rows: LadderRow[] = []
    bands.forEach((band, index) => {
      const shared = { bandId: band.id }
      rows.push({ kind: 'rung', key: `rung:${band.id}`, index })

      if (bandFolded(band)) {
        rows.push({ kind: 'summary', key: `sum:${band.id}`, ...shared, band })
        return
      }
      if (band.kind === 'entries') {
        for (const entry of band.entries) {
          rows.push({ kind: 'entry', key: `e:${entry.id}`, ...shared, entry })
          if (entry.type !== 'user_action') {
            rows.push({ kind: 'weight', key: `w:${entry.id}`, ...shared, entryId: entry.id })
          }
        }
        return
      }
      const interval = band.interval
      rows.push({ kind: 'interval', key: `g:${interval.afterEntryId}`, ...shared, interval })
      rows.push({ kind: 'gapWeight', key: `wg:${interval.afterEntryId}`, ...shared, interval })
    })
    rows.push({ kind: 'rung', key: 'rung:end', index: bands.length })
    return rows
  })

  function bandLabel(band: Band): string {
    if (band.kind === 'interval') return 'Time gap'
    const numbers = band.entries.map((entry) => entryNumber(entry.id))
    return numbers.length === 1
      ? `Entry ${numbers[0]}`
      : `Entries ${numbers[0]}–${numbers[numbers.length - 1]}`
  }

  function isUnfolded(key: string): boolean {
    return unfolded[key] === true
  }

  function toggleCard(key: string) {
    unfolded = { ...unfolded, [key]: !unfolded[key] }
  }

  /** What a band's fold is kept under: its entries, or for an interval its own band id. */
  function foldKeys(band: Band): string[] {
    return band.kind === 'entries' ? band.entries.map((entry) => entry.id) : [band.id]
  }

  function bandFolded(band: Band): boolean {
    return foldKeys(band).every((key) => folded[key])
  }

  function unfoldBand(band: Band) {
    const next = { ...folded }
    for (const key of foldKeys(band)) delete next[key]
    folded = next
  }

  function foldBand(id: string) {
    holdFocus()
    const band = bands.find((candidate) => candidate.id === id)
    if (!band) return
    folded = { ...folded, ...Object.fromEntries(foldKeys(band).map((key) => [key, true])) }
  }

  function openBand(id: string) {
    holdFocus()
    const band = bands.find((candidate) => candidate.id === id)
    if (band) unfoldBand(band)
  }

  const allFolded = $derived(bands.length > 0 && bands.every(bandFolded))

  function toggleAll() {
    holdFocus()
    folded = allFolded ? {} : Object.fromEntries(bands.flatMap(foldKeys).map((key) => [key, true]))
  }

  /**
   * The strip steers the reading: to the first band still owed a weight, or to the end when
   * nothing is outstanding and the reader only wants to apply.
   */
  /** Open what hides a card, and nothing else: the reader's other folds are their own work. */
  function revealCard(entryId: string, cardKey: string) {
    const band = bands.find((candidate) =>
      candidate.kind === 'entries'
        ? candidate.entries.some((entry) => entry.id === entryId)
        : candidate.interval.afterEntryId === entryId,
    )
    if (band) unfoldBand(band)
    unfolded = { ...unfolded, [cardKey]: true }
  }

  async function jump() {
    if (invalidWeights) {
      for (const [id, value] of Object.entries(supplied)) {
        if (durationIsInvalid(value)) revealCard(id, `w:${id}`)
      }
      for (const [id, value] of Object.entries(gapWeights)) {
        if (durationIsInvalid(value)) revealCard(id, `wg:${id}`)
      }
      await tick()
      ladderEl?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }
    const entryId = unreadable[0]?.entryId
    if (!resolved && entryId) {
      revealCard(entryId, `w:${entryId}`)
      await tick()
    }
    const target = resolved ? 'reconcile-footer' : `band-${entryId}`
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
</script>

<svelte:window
  onkeydowncapture={(event) => {
    if (fullTextId && event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      void closeFullText()
    }
  }}
/>

<Dialog.Root bind:open>
  <!--
    A dialog on a phone too, rather than the app's bottom drawer. This screen is a full surface
    the reader works down, not a panel pulled part-way up: sliding in from the bottom, a grab
    handle and drag-to-dismiss all say retractable, and a drag that dismisses a half-filled
    reconciliation is a gesture this screen cannot afford.
  -->
  <Dialog.Content
    onOpenAutoFocus={(event: Event) => {
      event.preventDefault()
      holdFocus()
    }}
    style={narrow
      ? '--tw-enter-translate-x: 0; --tw-enter-translate-y: 0; --tw-exit-translate-x: 0; --tw-exit-translate-y: 0; --tw-enter-scale: 1; --tw-exit-scale: 1;'
      : undefined}
    class={narrow
      ? 'top-0 left-0 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-0 p-0 pt-[var(--safe-top)] pb-[var(--safe-bottom)]'
      : 'flex h-[85vh] max-w-3xl flex-col pb-3'}
  >
    <!--
      The body stays mounted under the full text rather than being swapped out for it: unmounting
      a scroll container loses where the reader was, and returning to the top of a long ladder
      after reading one entry is the opposite of what the button is for.
    -->
    <div inert={!!fullTextEntry} class="flex min-h-0 flex-1 flex-col">
      {#if narrow}
        <div class="px-4 py-3 text-center">
          <Dialog.Title class="text-lg font-semibold">Reconcile a range</Dialog.Title>
        </div>

        <!--
          The first tabbable: when the trap loses the focused element it refocuses the first, and
          the reading area is the one place that can take focus without scrolling; see `holdFocus`.
        -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          bind:this={ladderEl}
          tabindex="0"
          role="region"
          aria-label="Range"
          class="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
        >
          {@render mobileBody()}
        </div>
      {:else}
        <!-- Title and buttons scroll: neither steers the reading, and the pinned band below does. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          bind:this={ladderEl}
          tabindex="0"
          role="region"
          aria-label="Range"
          class="-mx-6 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-6 outline-none"
        >
          <div
            class="border-border bg-background relative z-10 flex items-center justify-between gap-4 border-b py-4"
          >
            <div class="flex flex-col gap-1.5">
              <Dialog.Title class="text-lg leading-none font-semibold tracking-tight">
                Reconcile a range
              </Dialog.Title>
              <Dialog.Description class="text-muted-foreground text-sm">
                Fits the entries between two boundaries to the time they assert, keeping their
                relative pacing. Nothing outside the range is touched.
              </Dialog.Description>
            </div>
            <Dialog.Close>
              {#snippet child({ props })}
                <Button variant="destructive" size="icon" {...props}>
                  <X class="size-6!" />
                  <span class="sr-only">Close</span>
                </Button>
              {/snippet}
            </Dialog.Close>
          </div>

          {@render desktopBody()}

          <div class="border-border mt-4 flex justify-end gap-2 border-t py-2">
            <Button variant="outline" onclick={() => (open = false)}>
              {appliedMessage ? 'Close' : 'Cancel'}
            </Button>
            {#if appliedMessage && hasNextRange}
              <Button onclick={goToNextRange}>Go to next range</Button>
            {:else}
              <Button disabled={preview?.status !== 'ok' || applying} onclick={apply}>
                {applying ? 'Applying…' : 'Apply changes'}
              </Button>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    {#if fullTextEntry}
      <!--
        Over the whole surface, header and footer included, but inside the safe areas: reading an
        entry is its own screen, and the only way off it is Back. A stacked dialog could not do
        this — it is portalled outside this content, so dismissing it reads as a click outside and
        closes the whole screen as well.
      -->
      <div
        class="bg-background absolute inset-x-0 z-30 flex flex-col gap-3 rounded-[inherit] px-4 py-3 {narrow
          ? 'top-[var(--safe-top)] bottom-[var(--safe-bottom)]'
          : 'inset-y-0'}"
      >
        <Button
          variant="text"
          size="sm"
          class="h-8 w-fit px-1 text-xs"
          bind:ref={fullTextBack}
          onclick={closeFullText}
        >
          <ChevronLeft class="h-4 w-4" />
          Back
        </Button>
        <p class="text-sm font-medium">
          Entry {entryNumber(fullTextEntry.id)}
          <span class="text-muted-foreground font-normal">· {recordedText(fullTextEntry)}</span>
        </p>
        <p class="min-h-0 flex-1 overflow-y-auto text-sm whitespace-pre-wrap">
          {fullTextEntry.content}
        </p>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

{#snippet emptyRanges()}
  <p class="text-muted-foreground text-sm">
    There is nothing to reconcile yet. A range runs between two boundaries, and this story offers
    fewer than two.
  </p>
  <p class="text-muted-foreground text-xs">
    In view: {story.entries.length}
    {story.entries.length === 1 ? 'entry' : 'entries'}, {anchorsInView}
    {anchorsInView === 1 ? 'anchor' : 'anchors'}, {story.timeBoundaries.length}
    {story.timeBoundaries.length === 1 ? 'boundary' : 'boundaries'}.
  </p>
{/snippet}

{#snippet rangePicker()}
  <label class="text-sm">
    Range
    <select
      class="border-input bg-card mt-1 w-full rounded-md border px-2 py-1 text-sm"
      bind:value={selectedIndex}
    >
      {#each ranges as candidate, index (candidate.from.entryId + candidate.to.entryId)}
        <option value={index}>{rangeLabel(candidate)}</option>
      {/each}
    </select>
  </label>
{/snippet}

<!-- What the range is measured from, editable where it is read: an unanchored boundary resolves
     to a recorded ending, and only the reader can say otherwise. -->
{#snippet anchors(edgeToEdge: boolean)}
  {#if range}
    <!-- Rules across the surface, but the rows held to a readable width so the controls stay
         beside what they act on. The narrow body pads its children, so the rules reach the
         edges only by cancelling that padding, as the description above it does. -->
    <div class="border-border border-y py-1.5 text-xs {edgeToEdge ? '-mx-4 px-4' : ''}">
      <div class="max-w-md">
        <p class="text-foreground">Reference points</p>
        <div class="border-border/60 my-1 border-t"></div>
        {@render anchorRow('Start', 'from')}
        <div class="border-border/60 my-1 border-t"></div>
        {@render anchorRow('End', 'to')}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet anchorRow(label: string, which: 'from' | 'to')}
  {@const boundary = boundaryOf(which)}
  {#if boundary}
    {@const anchor = story.timeAnchorFor(boundary.entryId)}
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5">
      <span class="text-muted-foreground w-6 shrink-0">{label}</span>
      <span class="text-muted-foreground flex shrink-0 items-center gap-1">
        {#if anchor}
          <Anchor class="h-3 w-3" aria-label="Anchored" />
        {:else}
          <GitBranch class="h-3 w-3" aria-label="Natural boundary" />
        {/if}
        Entry {entryNumber(boundary.entryId)}
      </span>
      <!-- A natural boundary resolves to its recorded ending, which is a reading rather than an
           assertion: it is shown, dimmed, exactly as an unset one is. -->
      <span class="flex-1 truncate">
        {#if anchor}
          <span class="text-foreground font-medium">{stamp(anchor.assertedTime)}</span>
        {:else}
          <span class="text-muted-foreground"
            >{boundary.time ? stamp(boundary.time) : 'Not set'}</span
          >
        {/if}
      </span>
      <!-- Inert rather than gone while its own editor is open: a control that closes what it
           opened would take the reader's typing with it. What it opens follows what is there — an
           anchor is edited as an anchor, a boundary without one as the entry's own times. -->
      {#if anchor || anchorable(which)}
        <Button
          variant="outline"
          size="sm"
          class="h-6 w-16 shrink-0 text-[11px]"
          disabled={editing === which}
          onclick={() => (anchor ? editAnchor(which) : editEntryTime(which))}
        >
          Edit
        </Button>
      {:else}
        <span class="text-muted-foreground shrink-0">an action has no ending to anchor</span>
      {/if}
    </div>

    {#if editing === which}
      <div class="border-border bg-card mt-1 mb-1.5 flex flex-col gap-2 rounded-md border p-2">
        <Button
          variant="outline"
          size="sm"
          class="h-6 w-fit text-[11px]"
          onclick={(event: MouseEvent) =>
            showFullText(boundary.entryId, event.currentTarget as HTMLElement)}
        >
          Show full text
        </Button>

        {#if editingKind === 'anchor'}
          <label class="flex flex-wrap items-center gap-2">
            <span class="text-muted-foreground shrink-0">Asserted time</span>
            <Input
              placeholder="e.g. Y1 D4 14:30"
              class="h-7 w-36 text-xs"
              bind:value={anchorTimeText}
            />
            <span class="text-muted-foreground shrink-0">
              {anchorTime ? `= ${formatStoryTime(anchorTime)}` : 'year, day, clock'}
            </span>
          </label>
          {#if storyTimeIsInvalid(anchorTimeText)}
            <p class="text-destructive">Not a story time. Try 14:30, D4 14:30, or Y1 D4 14:30.</p>
          {/if}
          <label class="flex flex-col gap-1">
            <span class="text-muted-foreground">Note</span>
            <Textarea
              rows={2}
              autosize={false}
              maxlength={ANCHOR_NOTE_LIMIT}
              placeholder="optional"
              class="h-12 w-full resize-none text-xs"
              bind:value={anchorNote}
            />
          </label>
        {:else}
          <p class="text-muted-foreground">
            What this entry records for itself. Chapter spans, the clock kept for rollback and any
            checkpoint taken here follow it.
          </p>
          <label class="flex flex-wrap items-center gap-2">
            <span class="text-muted-foreground w-12 shrink-0">Begins</span>
            <Input
              placeholder="e.g. Y1 D4 14:30"
              class="h-7 w-36 text-xs"
              bind:value={entryStartText}
            />
          </label>
          <label class="flex flex-wrap items-center gap-2">
            <span class="text-muted-foreground w-12 shrink-0">Ends</span>
            <Input
              placeholder="e.g. Y1 D4 16:00"
              class="h-7 w-36 text-xs"
              bind:value={entryEndText}
            />
          </label>
          {#if storyTimeIsInvalid(entryStartText) || storyTimeIsInvalid(entryEndText)}
            <p class="text-destructive">
              Give both as Y1 D4 14:30. An unreadable time is left as it was.
            </p>
          {:else if entryBackwards}
            <p class="text-destructive">The entry cannot end before it begins.</p>
          {/if}
        {/if}

        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" class="h-6 text-[11px]" onclick={closeAnchorEditor}>
            Cancel
          </Button>
          {#if editingKind === 'anchor'}
            <Button
              size="sm"
              class="h-6 text-[11px]"
              disabled={!anchorTime || anchorSaving}
              onclick={saveAnchor}
            >
              {anchorSaving ? 'Saving…' : 'Save'}
            </Button>
          {:else}
            <Button
              size="sm"
              class="h-6 text-[11px]"
              disabled={!entryStart || !entryEnd || entryBackwards || anchorSaving}
              onclick={saveEntryTime}
            >
              {anchorSaving ? 'Saving…' : 'Save'}
            </Button>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
{/snippet}

{#snippet refusalCard(reason: RangeRefusal['reason'], boundaries: Boundary[])}
  <div class="border-destructive/50 bg-destructive/10 rounded-md border p-3 text-sm">
    <p class="flex items-center gap-2 font-medium">
      <TriangleAlert class="h-4 w-4" />
      {reason === 'backwards-span'
        ? 'These two boundaries contradict each other'
        : 'A boundary has no time'}
    </p>
    <p class="text-muted-foreground mt-1 text-xs">
      {#if reason === 'backwards-span'}
        Entry {entryNumber(boundaries[0].entryId)} is asserted at
        {stamp(boundaries[0].time)}, entry
        {entryNumber(boundaries[1].entryId)} at
        {stamp(boundaries[1].time)}. The later one asserts an earlier time, and only you can say
        which is wrong.
      {:else}
        {#each boundaries as boundary (boundary.entryId)}
          Entry {entryNumber(boundary.entryId)} has no recorded ending. Pin when it ended to use it as
          a boundary.
        {/each}
      {/if}
    </p>
  </div>
{/snippet}

{#snippet outcomeNotes()}
  {#if resolved && preview?.status === 'ok'}
    <div class="text-muted-foreground space-y-1 text-xs">
      {#if preview.result.leadingJoin.differenceMinutes !== 0}
        <p>
          The entry before this range still ends at
          {stamp(preview.result.leadingJoin.neighbourTime)}, so it will
          {preview.result.leadingJoin.differenceMinutes > 0 ? 'overlap' : 'leave a gap before'} the new
          start. Reconcile the range before this one to close it.
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
          The story's current time is unchanged: this range ends at entry
          {entryNumber(preview.range.to.entryId)}, and the story ends at entry
          {lastEntryNumber ?? '?'}. Widen the range to the end of the story to move the clock with
          it.
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
          compressed to no length, marked above. Their share of the pacing cannot be recovered by widening
          the range later.
        </span>
      </p>
    {/if}
  {/if}

  {#if staleMessage}
    <p class="text-destructive text-xs">{staleMessage}</p>
  {/if}

  {#if errorMessage}
    <p class="text-destructive text-xs">{errorMessage}</p>
  {/if}

  {#if appliedMessage}
    <p class="text-xs text-emerald-600 dark:text-emerald-400">{appliedMessage}</p>
  {/if}
{/snippet}

{#snippet desktopBody()}
  {#if ranges.length === 0}
    {@render emptyRanges()}
  {:else}
    <!-- Two pinned bands, not one: the anchors scroll away between them, so what the range is
         measured from is read once while what it comes to stays in view. -->
    <div class="bg-background sticky top-0 z-30 pt-4 pb-2" bind:clientHeight={pickerHeight}>
      {@render rangePicker()}
    </div>

    <div class="mb-3">
      {@render anchors(false)}
    </div>

    <div
      class="bg-background sticky z-20 flex flex-col gap-3 pb-2"
      style="top: {pickerHeight}px"
      bind:clientHeight={pinnedHeight}
    >
      <div class="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span>Was <span class="text-foreground">{spanText(recordedSpan)}</span></span>
        <span>Becomes <span class="text-foreground">{spanText(assertedSpan)}</span></span>
      </div>

      <!-- What the reader still has to settle is the reason to read the table at all. -->
      {#if invalidWeights}
        <p class="text-destructive flex items-start gap-1 text-xs">
          <TriangleAlert class="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            A weight you have typed is not a duration. Nothing is calculated until it reads as one.
          </span>
        </p>
      {:else if unreadable.length > 0}
        <p class="text-muted-foreground flex items-start gap-1 text-xs">
          <TriangleAlert class="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
          <span>
            {unreadable.length}
            {unreadable.length === 1 ? 'entry needs' : 'entries need'} a length. Nothing is calculated
            until each is settled.
          </span>
        </p>
      {/if}
    </div>

    {#if refusal}
      {@render refusalCard(refusal.reason, refusal.boundaries)}
    {:else}
      <div class="border-border bg-card rounded-lg border px-3 py-1">
        <table class="w-full border-collapse text-xs">
          <thead
            class="text-muted-foreground bg-card border-border sticky z-10 border-b text-left"
            style="top: {pickerHeight + pinnedHeight}px"
          >
            <tr>
              <th class="w-8 py-1 pr-2 font-medium">#</th>
              <th class="w-24 py-1 pr-2 font-medium">Label</th>
              <th class="py-1 pr-2 font-medium">Entry</th>
              <th class="w-36 py-1 pr-2 font-medium">Was</th>
              <th class="w-36 py-1 font-medium">Becomes</th>
            </tr>
          </thead>
          <tbody>
            {#each rangeEntries as entry (entry.id)}
              {@const request = requestFor(entry.id)}
              {@const reconciled = reconciledTimes(entry.id)}
              {@const interval = intervals.find((i) => i.afterEntryId === entry.id)}
              {@const was = wasWeight(entry.id)}
              <tr
                class="border-border/50 hover:bg-muted/60 cursor-pointer border-t {isOpen(
                  'entry',
                  entry.id,
                )
                  ? 'bg-primary/20'
                  : ''}"
                onclick={() => chooseRow('entry', entry.id)}
              >
                <td class="text-muted-foreground py-1 pr-2 align-top">{entryNumber(entry.id)}</td>
                <td class="py-1 pr-2 align-top">
                  <span class="flex items-center gap-1">
                    {#if request}
                      <TriangleAlert class="h-3 w-3 shrink-0 text-amber-600" />
                    {/if}
                    {@render entryChip(entry.id)}
                  </span>
                </td>
                <td class="py-1 pr-2 align-top">
                  <span class="line-clamp-3 {isAction(entry.id) ? 'italic' : ''}">
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
                  {#if reconciled}
                    <div class="grid grid-cols-[auto_1fr] gap-x-2">
                      {#if isAction(entry.id)}
                        <span>At:</span><span>{stamp(reconciled.end)}</span>
                      {:else}
                        <span>Start:</span><span>{stamp(reconciled.start)}</span>
                        <span>End:</span><span>{stamp(reconciled.end)}</span>
                        <span>Weight:</span>
                        <span class="flex items-center gap-1">
                          {#if collapsed.includes(entry.id)}
                            <TriangleAlert class="h-3 w-3 shrink-0 text-amber-600" />
                          {/if}
                          {formatDuration(toMinutes(reconciled.end) - toMinutes(reconciled.start))}
                        </span>
                      {/if}
                    </div>
                  {:else}
                    <span class="text-muted-foreground">—</span>
                  {/if}
                </td>
              </tr>

              {#if isOpen('entry', entry.id)}
                <tr class="border-border/50 bg-background border-t">
                  <td colspan="5" class="p-2">{@render entryPanel(entry)}</td>
                </tr>
              {/if}

              {#if interval}
                {@const scaled = scaledInterval(interval.afterEntryId, interval.beforeEntryId)}
                <tr
                  class="border-border/50 hover:bg-muted/60 cursor-pointer border-t {isOpen(
                    'gap',
                    interval.afterEntryId,
                  )
                    ? 'bg-primary/20'
                    : 'bg-muted/40'}"
                  onclick={() => chooseRow('gap', interval.afterEntryId)}
                >
                  <td class="py-1 pr-2"></td>
                  <td class="py-1 pr-2 align-top">
                    <span class="flex items-center gap-1">{@render gapChip()}</span>
                  </td>
                  <td class="text-muted-foreground py-1 pr-2 align-top">
                    Time not claimed by adjacent entries
                  </td>
                  <td class="text-muted-foreground py-1 pr-2 align-top whitespace-nowrap">
                    <div class="grid grid-cols-[auto_1fr] gap-x-2">
                      <span>Weight:</span>
                      <span
                        class={statedWeights[interval.afterEntryId] !== undefined
                          ? 'text-foreground font-medium'
                          : ''}
                      >
                        {formatDuration(interval.recordedMinutes)}
                      </span>
                    </div>
                  </td>
                  <td class="text-muted-foreground py-1 align-top whitespace-nowrap">
                    <div class="grid grid-cols-[auto_1fr] gap-x-2">
                      <span>Weight:</span>
                      <span>
                        {#if scaled === null}
                          —
                        {:else if scaled === 0}
                          closed
                        {:else}
                          {formatDuration(scaled)}
                        {/if}
                      </span>
                    </div>
                  </td>
                </tr>

                {#if isOpen('gap', interval.afterEntryId)}
                  <tr class="border-border/50 bg-background border-t">
                    <td colspan="5" class="p-2">{@render intervalPanel(interval)}</td>
                  </tr>
                {/if}
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    <!-- Closes the table off: what follows is about the range, not about a row in it. -->
    <div class="border-border mt-3 flex flex-col gap-3 border-t pt-3">
      {@render outcomeNotes()}
    </div>
  {/if}
{/snippet}

{#snippet mobileBody()}
  <div class="flex flex-col gap-3 px-4 pb-2">
    {#if ranges.length === 0}
      {@render emptyRanges()}
      <!-- The footer carries Close, and there is no footer without a range to apply. -->
      <Button variant="outline" class="w-fit" onclick={() => (open = false)}>Close</Button>
    {:else}
      <div class="border-border -mx-4 border-b px-4 pt-1 pb-3">
        <Dialog.Description class="text-muted-foreground text-xs">
          Fits the entries between two boundaries to the time they assert, keeping their relative
          pacing. Nothing outside the range is touched.
        </Dialog.Description>
      </div>
      {@render rangePicker()}
      {@render anchors(true)}

      {#if bands.length > 1}
        <div class="text-muted-foreground flex items-center gap-2 text-[11px]">
          <Button
            variant="outline"
            size="sm"
            class="text-foreground h-7 shrink-0 text-xs"
            onclick={toggleAll}
          >
            {allFolded ? 'Expand all' : 'Collapse all'}
          </Button>
          <span>swipe a band ◂ to fold, ▸ a summary to open</span>
        </div>
      {/if}
    {/if}
  </div>

  {#if ranges.length > 0}
    <!-- The one thing that must not scroll away: it is what the reader steers by. -->
    <div class="bg-background border-border sticky top-0 z-10 border-y px-4 py-2">
      {#if isRefused}
        <!-- Nothing to steer towards: the range is refused, and no weight changes that. -->
        <p class="text-destructive flex items-center gap-2 text-xs">
          <TriangleAlert class="h-3.5 w-3.5 shrink-0" />
          <span class="flex-1">This range cannot be reconciled as it stands</span>
        </p>
      {:else}
        <button
          type="button"
          class="flex w-full items-center gap-2 text-left text-xs"
          onclick={jump}
        >
          {#if invalidWeights}
            <span class="text-destructive flex-1">Correct invalid weights before applying</span>
          {:else if resolved}
            <span class="flex-1">Nothing outstanding</span>
            <span class="text-muted-foreground shrink-0">Jump to end ›</span>
          {:else}
            <TriangleAlert class="h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span class="flex-1">
              {unreadable.length}
              {unreadable.length === 1 ? 'entry still needs' : 'entries still need'} a weight
            </span>
            <span class="text-muted-foreground shrink-0">Jump ›</span>
          {/if}
        </button>
      {/if}
    </div>

    <div class="flex flex-col gap-3 px-4 pt-3 pb-4">
      {#if refusal}
        {@render refusalCard(refusal.reason, refusal.boundaries)}
      {:else}
        {@render ladder()}
      {/if}

      {@render outcomeNotes()}

      <div id="reconcile-footer" class="flex gap-2 pt-2">
        <Button variant="outline" class="flex-1" onclick={() => (open = false)}>
          {appliedMessage ? 'Close' : 'Cancel'}
        </Button>
        {#if appliedMessage && hasNextRange}
          <Button class="flex-1" onclick={goToNextRange}>Go to next range</Button>
        {:else}
          <Button class="flex-1" disabled={preview?.status !== 'ok' || applying} onclick={apply}>
            {applying ? 'Applying…' : 'Apply changes'}
          </Button>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet ladder()}
  <!-- Which rail is which, and what each one comes to, stated once rather than on every rung. -->
  <div class="-mx-2 mb-1 flex items-end justify-between px-3 text-[10px]">
    <span class="flex flex-col gap-0.5">
      <span class="text-muted-foreground tracking-wide uppercase">Was</span>
      <span class="text-muted-foreground">
        <span class="text-foreground font-medium">{spanText(recordedSpan)}</span> total
      </span>
    </span>
    <span class="flex flex-col items-end gap-0.5">
      <span class="text-muted-foreground tracking-wide uppercase">Becomes</span>
      <span class="text-muted-foreground">
        <span class="text-foreground font-medium">{spanText(assertedSpan)}</span> total
      </span>
    </span>
  </div>

  <!-- Two unbroken rails, the dots riding on top of them. -->
  <div class="relative -mx-2">
    <span class="bg-foreground/40 absolute inset-y-0 left-[3px] w-px"></span>
    <span class="bg-foreground/40 absolute inset-y-0 right-[3px] w-px"></span>
    <div class="relative flex flex-col px-3">
      {#if preview?.status === 'ok' && preview.result.leadingJoin.differenceMinutes !== 0}
        {@render joinStub(
          `Entry ${entryNumber(preview.range.entryIds[0])} is preceded by one still ending at ${stamp(
            preview.result.leadingJoin.neighbourTime,
          )}`,
        )}
      {/if}

      {#each ladderRows as row (row.key)}
        {#if row.kind === 'rung'}
          {@render rung(row.index)}
        {:else}
          <div
            class="pb-1"
            use:swipe={{
              threshold: 48,
              onSwipeLeft: () => foldBand(row.bandId),
              onSwipeRight: () => openBand(row.bandId),
            }}
          >
            {#if row.kind === 'summary'}
              {@render bandSummary(row.band)}
            {:else if row.kind === 'entry'}
              {@render entryCard(row.entry)}
            {:else if row.kind === 'weight'}
              {@render weightCard(row.entryId)}
            {:else if row.kind === 'interval'}
              {@render intervalCard(row.interval)}
            {:else}
              {@render gapWeightCard(row.interval)}
            {/if}
          </div>
        {/if}
      {/each}

      {#if preview?.status === 'ok' && preview.result.trailingJoin && preview.result.trailingJoin.differenceMinutes !== 0}
        {@render joinStub(
          `The next entry still begins at ${stamp(preview.result.trailingJoin.neighbourTime)}`,
        )}
      {/if}
    </div>
  </div>
{/snippet}

{#snippet joinStub(text: string)}
  <p class="text-muted-foreground py-1 text-[11px]">{text}</p>
{/snippet}

{#snippet rung(index: number)}
  {@const point = rungs[index]}
  {#if point}
    {@const before = stampParts(point.recorded)}
    {@const after = stampParts(point.reconciled)}
    <div class="relative flex items-center gap-1 py-1.5 font-mono text-[10px]">
      <!-- The dots sit on the rails, which run behind them unbroken. -->
      <span
        class="bg-foreground/70 absolute top-1/2 -left-3 size-[7px] -translate-y-1/2 rounded-full"
      ></span>
      <span class="flex shrink-0 gap-1">
        {#each before as part, i (i)}
          <!-- The record lights only where it disagrees: the eye tracks what moves. -->
          <span class={after[i] === part ? 'text-muted-foreground/60' : 'text-foreground'}>
            {part}
          </span>
        {/each}
      </span>
      <span class="bg-border/70 h-px min-w-2 flex-1"></span>
      <span class="text-foreground shrink-0 font-medium">{after.join(' ')}</span>
      <span
        class="bg-foreground/70 absolute top-1/2 -right-3 size-[7px] -translate-y-1/2 rounded-full"
      ></span>
    </div>
  {/if}
{/snippet}

{#snippet bandSummary(band: Band)}
  {@const length = bandLength(band)}
  <button
    type="button"
    aria-expanded="false"
    onclick={() => openBand(band.id)}
    class="border-border bg-muted/30 mb-2 flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left"
  >
    <span class="flex-1 text-xs">{bandLabel(band)}</span>
    {#if bandUnsettled(band)}
      <span class="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-500">
        <TriangleAlert class="h-3 w-3 shrink-0" />
        needs a weight
      </span>
    {:else}
      <span class="text-muted-foreground text-xs">
        {length === null ? '—' : formatDuration(length)}
      </span>
    {/if}
  </button>
{/snippet}

{#snippet cardShell(
  key: string,
  header: Snippet,
  body: Snippet,
  controls: Snippet,
  anchorId?: string,
)}
  <div id={anchorId} class="border-border bg-card mb-2 rounded-md border">
    <button
      type="button"
      class="flex w-full flex-col gap-1 p-2 text-left"
      aria-expanded={isUnfolded(key)}
      onclick={() => toggleCard(key)}
    >
      <span class="flex w-full items-center gap-2 text-[11px]">
        {@render header()}
        {#if isUnfolded(key)}
          <ChevronDown class="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        {:else}
          <ChevronRight class="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        {/if}
      </span>
      {@render body()}
    </button>
    {#if isUnfolded(key)}
      <div class="border-border/60 flex flex-col items-start gap-2 border-t p-2 text-xs">
        {@render controls()}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet entryCard(entry: StoryEntry)}
  {@const request = requestFor(entry.id)}
  {#snippet header()}
    {@render entryChip(entry.id)}
    <span class="flex-1">Entry {entryNumber(entry.id)}</span>
    {#if request}
      <TriangleAlert class="h-3 w-3 shrink-0 text-amber-600" />
    {/if}
  {/snippet}
  {#snippet body()}
    <span class="line-clamp-3 text-xs {isAction(entry.id) ? 'italic' : ''}">
      {entryText(entry.id)}
    </span>
  {/snippet}
  {#snippet controls()}
    <Button
      variant="outline"
      size="sm"
      class="h-7 text-xs"
      onclick={(event) => showFullText(entry.id, event.currentTarget)}
    >
      Show full text
    </Button>
    {#if isAction(entry.id)}
      <p class="text-muted-foreground">
        An action is an instant — the clock advances while the story responds, not while you decide.
        It weighs nothing and takes no length.
      </p>
    {:else if canAddGap(entry.id)}
      <Button variant="outline" size="sm" class="h-7 text-xs" onclick={() => addGap(entry.id)}>
        <Plus class="h-3.5 w-3.5" />
        Add a time gap after this entry
      </Button>
    {/if}
  {/snippet}
  {@render cardShell(`e:${entry.id}`, header, body, controls, `band-${entry.id}`)}
{/snippet}

{#snippet intervalCard(interval: RangeInterval)}
  {#snippet header()}
    {@render gapChip()}
    <span class="flex-1">after {entryNumber(interval.afterEntryId)}</span>
  {/snippet}
  {#snippet body()}
    <span class="text-muted-foreground line-clamp-2 text-xs">
      Time not claimed by adjacent entries.
    </span>
  {/snippet}
  {#snippet controls()}
    <p class="text-muted-foreground">
      {describeMinutes(originalGapMinutes(interval.afterEntryId))} between entry
      {entryNumber(interval.afterEntryId)} and entry
      {entryNumber(interval.beforeEntryId)}, not claimed by either of them.
    </p>
    {#if addedGapIds.includes(interval.afterEntryId)}
      <Button
        variant="text"
        size="sm"
        class="text-destructive h-7 px-1 text-xs"
        onclick={() => removeGap(interval.afterEntryId)}
      >
        Remove this time gap
      </Button>
    {/if}
  {/snippet}
  {@render cardShell(`g:${interval.afterEntryId}`, header, body, controls)}
{/snippet}

{#snippet weightPair(was: string, becomes: string, stated: boolean)}
  <span class="text-muted-foreground text-xs">
    {stated ? 'set' : 'was'}
    <span class="text-foreground font-medium">{was}</span>
    → becomes <span class="text-foreground font-medium">{becomes}</span>
  </span>
{/snippet}

{#snippet weightCard(entryId: string)}
  {@const was = wasWeight(entryId)}
  {@const reconciled = reconciledTimes(entryId)}
  {@const request = requestFor(entryId)}
  {#snippet header()}
    <span class="text-muted-foreground flex-1 tracking-wide uppercase">Weight</span>
    {#if request}
      <span class="flex shrink-0 items-center gap-1 text-amber-700 dark:text-amber-500">
        <TriangleAlert class="h-3 w-3 shrink-0" />
        unreadable
      </span>
    {:else if collapsed.includes(entryId)}
      <span class="flex shrink-0 items-center gap-1 text-amber-700 dark:text-amber-500">
        <TriangleAlert class="h-3 w-3 shrink-0" />
        no length
      </span>
    {:else if was.supplied}
      <span class="text-muted-foreground flex shrink-0 items-center gap-1">
        <Pencil class="h-3 w-3 shrink-0" />
        edited
      </span>
    {/if}
  {/snippet}
  {#snippet body()}
    {@render weightPair(
      was.text,
      reconciled ? formatDuration(toMinutes(reconciled.end) - toMinutes(reconciled.start)) : '—',
      was.supplied,
    )}
  {/snippet}
  {#snippet controls()}
    {#if request}
      <p class="flex items-start gap-1 text-amber-700 dark:text-amber-500">
        <TriangleAlert class="mt-0.5 h-3 w-3 shrink-0" />
        <span>{reasonText(request.reason)}</span>
      </p>
    {/if}
    <p class="text-muted-foreground">
      Recorded
      <span class="text-foreground">
        {stampRange(byId.get(entryId)?.metadata?.timeStart, byId.get(entryId)?.metadata?.timeEnd)}
      </span>
    </p>
    <p class="text-muted-foreground">
      Originally weighed as
      <span class="text-foreground">
        {recordedWeight(entryId) === null
          ? 'unreadable'
          : formatDuration(recordedWeight(entryId) ?? 0)}
      </span>
    </p>
    <label class="flex w-full flex-col gap-1">
      <span class="text-muted-foreground">Set custom weight (minutes or units y d h m):</span>
      <span class="flex items-center gap-2">
        <Input
          placeholder="e.g. 90, 2h 30m, 3d"
          class="h-10 min-w-0 flex-1 text-base"
          aria-invalid={durationIsInvalid(supplied[entryId])}
          bind:value={supplied[entryId]}
        />
        {#if supplied[entryId]}
          <Button
            variant="text"
            size="sm"
            class="h-7 shrink-0 px-1 text-xs"
            onclick={() => clearOverride(entryId)}
          >
            Clear
          </Button>
        {/if}
      </span>
    </label>
    {#if durationIsInvalid(supplied[entryId])}
      <p class="text-destructive">Not a duration. Try a number of minutes, or units like 2h 30m.</p>
    {/if}
    <p class="text-muted-foreground">
      This sets what the entry is <em>worth</em>, not the length it ends up with: the range is
      fitted to its boundaries, so each entry takes a share in proportion to its weight.
    </p>
  {/snippet}
  {@render cardShell(`w:${entryId}`, header, body, controls)}
{/snippet}

{#snippet gapWeightCard(interval: RangeInterval)}
  {@const scaled = scaledInterval(interval.afterEntryId, interval.beforeEntryId)}
  {@const edited = statedWeights[interval.afterEntryId] !== undefined}
  {#snippet header()}
    <span class="text-muted-foreground flex-1 tracking-wide uppercase">Weight</span>
    {#if edited}
      <span class="text-muted-foreground flex shrink-0 items-center gap-1">
        <Pencil class="h-3 w-3 shrink-0" />
        edited
      </span>
    {/if}
  {/snippet}
  {#snippet body()}
    {@render weightPair(
      formatDuration(interval.recordedMinutes),
      scaled === null ? '—' : scaled === 0 ? 'closed' : formatDuration(scaled),
      edited,
    )}
  {/snippet}
  {#snippet controls()}
    <p class="text-muted-foreground">
      Originally weighed as
      <span class="text-foreground">
        {formatDuration(originalGapMinutes(interval.afterEntryId))}
      </span>
    </p>
    <label class="flex w-full flex-col gap-1">
      <span class="text-muted-foreground">Set custom weight (minutes or units y d h m):</span>
      <span class="flex items-center gap-2">
        <Input
          aria-invalid={durationIsInvalid(gapWeights[interval.afterEntryId])}
          value={gapWeights[interval.afterEntryId] ?? ''}
          oninput={(event) => setGapWeight(interval.afterEntryId, event.currentTarget.value)}
          placeholder="e.g. 90, 2h 30m, 3d"
          class="h-10 min-w-0 flex-1 text-base"
        />
        {#if gapWeights[interval.afterEntryId]}
          <Button
            variant="text"
            size="sm"
            class="h-7 shrink-0 px-1 text-xs"
            onclick={() => {
              holdFocus()
              setGapWeight(interval.afterEntryId, '')
            }}
          >
            Clear
          </Button>
        {/if}
      </span>
    </label>
    {#if durationIsInvalid(gapWeights[interval.afterEntryId])}
      <p class="text-destructive">Not a duration. Try a number of minutes, or units like 2h 30m.</p>
    {/if}
    <p class="text-muted-foreground">
      A weight of nothing closes the interval, leaving the entries either side adjacent.
    </p>
  {/snippet}
  {@render cardShell(`wg:${interval.afterEntryId}`, header, body, controls)}
{/snippet}

{#snippet intervalPanel(interval: RangeInterval)}
  <div class="border-border rounded-md border p-3 text-xs">
    <p class="mb-2 font-medium">
      Time gap · after entry {entryNumber(interval.afterEntryId)}
    </p>
    <p class="text-muted-foreground mb-2">
      {describeMinutes(interval.recordedMinutes)} between entry
      {entryNumber(interval.afterEntryId)} and entry
      {entryNumber(interval.beforeEntryId)}, not claimed by either of them.
    </p>

    <div class="text-muted-foreground mb-2 flex flex-wrap gap-x-6 gap-y-1">
      <span>
        Originally weighed as
        <span class="text-foreground">
          {formatDuration(originalGapMinutes(interval.afterEntryId))}
        </span>
      </span>
      <span>
        Custom weight set as
        <span class="text-foreground">
          {statedWeights[interval.afterEntryId] === undefined
            ? 'not set'
            : formatDuration(statedWeights[interval.afterEntryId])}
        </span>
      </span>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <label class="flex items-center gap-2">
        <span class="text-muted-foreground shrink-0">Set custom weight</span>
        <Input
          aria-invalid={durationIsInvalid(gapWeights[interval.afterEntryId])}
          value={gapWeights[interval.afterEntryId] ?? ''}
          oninput={(event) => setGapWeight(interval.afterEntryId, event.currentTarget.value)}
          placeholder="e.g. 90, 2h 30m, 3d"
          class="h-7 w-48 text-xs"
        />
      </label>
      <span class="text-muted-foreground">minutes, or units: y d h m</span>
      {#if gapWeights[interval.afterEntryId]}
        <Button
          variant="text"
          size="sm"
          class="h-7 text-xs"
          onclick={() => {
            holdFocus()
            setGapWeight(interval.afterEntryId, '')
          }}
        >
          Clear
        </Button>
      {/if}
    </div>
    {#if durationIsInvalid(gapWeights[interval.afterEntryId])}
      <p class="text-destructive mt-1">
        Not a duration. Try a number of minutes, or units like 2h 30m.
      </p>
    {/if}
    <p class="text-muted-foreground mt-2">
      A weight of nothing closes the interval, leaving the entries either side adjacent.
    </p>

    {#if addedGapIds.includes(interval.afterEntryId)}
      <Button
        variant="text"
        size="sm"
        class="text-destructive mt-2 h-8 px-2"
        onclick={() => removeGap(interval.afterEntryId)}
      >
        Remove this time gap
      </Button>
    {/if}
  </div>
{/snippet}

{#snippet entryPanel(entry: StoryEntry)}
  {@const request = requestFor(entry.id)}
  <div class="border-border rounded-md border p-3 text-xs">
    <p class="mb-2 flex items-center gap-2 font-medium">
      <span
        class="rounded px-1 text-[10px] tracking-wide uppercase {isAction(entry.id)
          ? 'bg-muted text-foreground'
          : 'bg-background text-foreground'}"
      >
        {label(entry.id)}
      </span>
      Entry {entryNumber(entry.id)}
    </p>
    <Button
      variant="outline"
      size="sm"
      class="mb-2 h-7 text-xs"
      onclick={(event) => showFullText(entry.id, event.currentTarget)}
    >
      Show full text
    </Button>

    {#if request}
      <p class="mb-2 flex items-start gap-1 text-amber-700 dark:text-amber-500">
        <TriangleAlert class="mt-0.5 h-3 w-3 shrink-0" />
        <span>{reasonText(request.reason)}</span>
      </p>
    {/if}

    {#if isAction(entry.id)}
      <p class="text-muted-foreground">
        An action is an instant — the clock advances while the story responds, not while you decide.
        It weighs nothing and takes no length.
      </p>
    {:else}
      <div class="text-muted-foreground mb-2 flex flex-wrap gap-x-6 gap-y-1">
        <span>
          Recorded
          <span class="text-foreground">
            {stampRange(entry.metadata?.timeStart, entry.metadata?.timeEnd)}
          </span>
        </span>
        <span>
          Originally weighed as
          <span class="text-foreground">
            {recordedWeight(entry.id) === null
              ? 'unreadable'
              : formatDuration(recordedWeight(entry.id) ?? 0)}
          </span>
        </span>
        <span>
          Custom weight set as
          <span class="text-foreground">
            {overrides[entry.id] === undefined ? 'not set' : formatDuration(overrides[entry.id])}
          </span>
        </span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-2">
          <span class="text-muted-foreground shrink-0">Set custom weight</span>
          <Input
            aria-invalid={durationIsInvalid(supplied[entry.id])}
            placeholder="e.g. 90, 2h 30m, 3d"
            class="h-7 w-48 text-xs"
            bind:value={supplied[entry.id]}
          />
        </label>
        <span class="text-muted-foreground">
          {#if overrides[entry.id] !== undefined}
            = {formatDuration(overrides[entry.id])}
          {:else}
            minutes, or units: y d h m
          {/if}
        </span>
        {#if supplied[entry.id]}
          <Button
            variant="text"
            size="sm"
            class="h-7 text-xs"
            onclick={() => clearOverride(entry.id)}
          >
            Clear
          </Button>
        {/if}
      </div>
      {#if durationIsInvalid(supplied[entry.id])}
        <p class="text-destructive mt-1">
          Not a duration. Try a number of minutes, or units like 2h 30m.
        </p>
      {/if}
      <p class="text-muted-foreground mt-2">
        This sets what the entry is <em>worth</em>, not the length it ends up with: the range is
        fitted to its boundaries, so each entry takes a share in proportion to its weight.
      </p>
    {/if}

    {#if canAddGap(entry.id)}
      <Button variant="outline" size="sm" class="mt-2 h-7 text-xs" onclick={() => addGap(entry.id)}>
        <Plus class="h-3.5 w-3.5" />
        Add a time gap after this entry
      </Button>
    {/if}
  </div>
{/snippet}

{#snippet entryChip(entryId: string)}
  <span
    class="shrink-0 rounded px-1 text-[10px] tracking-wide uppercase {isAction(entryId)
      ? 'bg-muted text-foreground'
      : 'bg-background text-foreground'}"
  >
    {label(entryId)}
  </span>
{/snippet}

{#snippet gapChip()}
  <span
    class="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] tracking-wide text-amber-700 uppercase dark:text-amber-500"
  >
    Time gap
  </span>
{/snippet}
