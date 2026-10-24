<script lang="ts">
  import type { StoryEntry } from '#lib/types/index.ts'
  import { gapMessage, revertLines, type GapOverride } from '#lib/services/stateTracking/index.ts'
  import { story, type AnchorLabel, type PastCheckpointPreview } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { settings } from '#lib/stores/settings.svelte.ts'
  import { canCreateCheckpointAt, entryNumber } from '#lib/utils/storyNavigation.ts'
  import { errMessage } from '#lib/utils/error.ts'
  import { Checkbox } from '#lib/components/ui/checkbox/index.ts'
  import { Input } from '#lib/components/ui/input/index.ts'
  import { RadioGroup, RadioGroupItem } from '#lib/components/ui/radio-group/index.ts'
  import { Bookmark, Check, ChevronDown, ChevronRight, TriangleAlert, X } from '@lucide/svelte'
  import ChangeList from './ChangeList.svelte'
  import ActionModal from '#lib/components/shared/ActionModal.svelte'
  import ExplanationFold from '#lib/components/shared/ExplanationFold.svelte'

  let entry = $state<StoryEntry | null>(null)
  let name = $state('')
  // For a past entry: whether it can be rebuilt, and the manual changes that would undo.
  let pastCheckpoint = $state<PastCheckpointPreview | null>(null)
  let saving = $state(false)
  // A refused past checkpoint can still be built from a full state the reader picks.
  let advancedOpen = $state(false)
  let overruleGaps = $state(false)
  let gapOverride = $state<GapOverride>('undoRecorded')

  const isLatestEntry = $derived(
    !!entry && story.entries[story.entries.length - 1]?.id === entry.id,
  )
  const overriding = $derived(!!pastCheckpoint?.refusal && overruleGaps)
  const overrideAnchor = $derived(
    gapOverride === 'previousAsIs'
      ? (pastCheckpoint?.overrides?.previous ?? null)
      : (pastCheckpoint?.overrides?.next ?? null),
  )
  // What the rebuild undoes is shown only for a rebuild that undoes: a clean one, or the override.
  const showUndone = $derived(
    !!pastCheckpoint && (!pastCheckpoint.refusal || (overriding && gapOverride === 'undoRecorded')),
  )
  const blocked = $derived(
    !isLatestEntry &&
      (pastCheckpoint === null ||
        (pastCheckpoint.refusal !== null && !(overriding && overrideAnchor))),
  )

  $effect(() => {
    const id = ui.checkpointFormEntryId
    if (!id) return
    ui.requestCheckpointForm(null)
    void open(id)
  })

  async function open(id: string) {
    const target = story.entries.find((e) => e.id === id)
    const allowed =
      !!target &&
      canCreateCheckpointAt(target, {
        entries: story.entries,
        checkpoints: story.checkpoints,
        currentBranchId: story.currentStory?.currentBranchId ?? null,
        tracking: settings.experimentalFeatures.stateTracking,
        locked: ui.isGenerating || story.isRetryInProgress || story.isGenerationLeaseHeld,
      })
    if (!target || !allowed) {
      ui.showToast('A checkpoint cannot be created at this entry', 'info')
      return
    }
    entry = target
    name = ''
    pastCheckpoint = null
    advancedOpen = false
    overruleGaps = false
    if (isLatestEntry) return
    try {
      pastCheckpoint = await story.previewCheckpointAt(target.id)
      gapOverride = pastCheckpoint.overrides?.next ? 'undoRecorded' : 'previousAsIs'
    } catch (error) {
      console.error('[CreateCheckpointModal] Could not preview the checkpoint:', error)
      entry = null
      ui.showToast(errMessage(error), 'error')
    }
  }

  function setOverruleGaps(checked: boolean) {
    overruleGaps = checked
    if (checked && !name.trim()) name = 'Approximate — '
  }

  function skippedSnapshotText(position: number): string {
    return `The snapshot at entry ${position + 1} was saved without the lorebook, so it can't be used.`
  }

  const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1)

  function anchorText(label: AnchorLabel): string {
    if (label.kind === 'live') return 'the last entry world state'
    const number = label.position + 1
    return label.kind === 'checkpoint'
      ? `checkpoint “${label.name ?? ''}” at entry ${number}`
      : `a snapshot at entry ${number}`
  }

  async function create() {
    if (!entry || !name.trim() || blocked || saving) return
    saving = true
    try {
      if (isLatestEntry) await story.createCheckpoint(name.trim())
      else {
        await story.createCheckpointAt(entry.id, name.trim(), {
          override: overriding ? gapOverride : undefined,
        })
      }
      entry = null
    } catch (error) {
      console.error('[CreateCheckpointModal] Failed to create checkpoint:', error)
      alert(errMessage(error))
    } finally {
      saving = false
    }
  }

  function cancel() {
    entry = null
  }
</script>

{#snippet finding(status: 'ok' | 'warn' | 'fail', text: string)}
  <li class="flex items-start gap-1.5">
    {#if status === 'ok'}
      <Check class="mt-px h-3.5 w-3.5 shrink-0 text-green-500" />
    {:else if status === 'warn'}
      <TriangleAlert class="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
    {:else}
      <X class="mt-px h-3.5 w-3.5 shrink-0 text-red-500" />
    {/if}
    <span>{text}</span>
  </li>
{/snippet}

{#snippet option(value: GapOverride, title: string, anchor: AnchorLabel | null, note?: string)}
  <div class="flex items-start gap-2">
    <RadioGroupItem {value} id={`gap-${value}`} disabled={!anchor} class="mt-0.5" />
    <label for={`gap-${value}`} class:opacity-50={!anchor}>
      <span class="text-foreground">{title}</span>
      <span class="block">
        {anchor ? `Data origin: ${anchorText(anchor)}.` : 'None was saved.'}
      </span>
      {#if anchor && note}
        <span class="block">{note}</span>
      {/if}
    </label>
  </div>
{/snippet}

<!-- Modal: the story must not change while the checkpoint is described and taken. -->
<ActionModal
  presentation="sheet"
  open={entry !== null}
  onCancel={cancel}
  title={entry ? `Create a checkpoint at entry ${entryNumber(entry)}` : 'Create a checkpoint'}
  action={{
    label: 'Create checkpoint',
    icon: Bookmark,
    tone: 'checkpoint',
    disabled: !name.trim() || blocked,
    onConfirm: create,
  }}
  busy={saving}
>
  {#if entry}
    {@const number = entryNumber(entry)}
    <Input
      type="text"
      class="h-9 text-sm"
      placeholder="Checkpoint name..."
      bind:value={name}
      disabled={saving}
      data-autofocus
      enterkeyhint="go"
      onkeydown={(e) => {
        if (e.key === 'Enter' && !e.isComposing && !e.ctrlKey && !e.metaKey) create()
      }}
    />
    <div class="text-muted-foreground space-y-1 text-xs">
      <p>Checkpoints save the story state and allow branching.</p>
      <!-- The latest entry is checkpointed from the current state; nothing is rebuilt. -->
      {#if !isLatestEntry}
        <ExplanationFold id="checkpoint_help" summary="How past checkpoints work">
          <p>
            Historical checkpoints rely on the state diffs that are recorded alongside the tracked
            entries, and calculate past state through the rollback from the nearest full-state
            landmark: an automated snapshot, another checkpoint, or current state.
          </p>
        </ExplanationFold>
      {/if}
    </div>

    {#if isLatestEntry}
      <!-- The latest entry is checkpointed from the current state: nothing to check. -->
    {:else if pastCheckpoint === null}
      <p class="text-muted-foreground text-xs italic">Checking the recorded world state changes…</p>
    {:else if pastCheckpoint.refusal}
      <!-- The diagnosis below explains a refusal; the warning only heads it. -->
      <p class="text-xs text-amber-500">
        {pastCheckpoint.diagnosis
          ? 'The world state at this entry cannot be guaranteed.'
          : pastCheckpoint.refusal}
      </p>
      {#if pastCheckpoint.diagnosis}
        {@const diagnosis = pastCheckpoint.diagnosis}
        <!-- An old record holds part of the history, so it warns rather than fails. -->
        <ul class="text-muted-foreground space-y-1 text-xs">
          {@render finding(
            diagnosis.target === 'recorded'
              ? 'ok'
              : diagnosis.target === 'classifierOnly'
                ? 'warn'
                : 'fail',
            diagnosis.target === 'recorded'
              ? `World state changes were recorded for entry ${number}.`
              : diagnosis.target === 'classifierOnly'
                ? `Entry ${number} has an old world state record without the lorebook.`
                : `World state changes were not recorded for entry ${number}.`,
          )}
          {@render finding(
            diagnosis.anchor ? 'ok' : 'fail',
            diagnosis.anchor
              ? `The nearest full world state is ${anchorText(diagnosis.anchor)}.`
              : 'No full world state was saved after this entry.',
          )}
          {#each pastCheckpoint.skipped as position, i (i)}
            {@render finding('warn', skippedSnapshotText(position))}
          {/each}
          {#if diagnosis.anchor}
            {#each diagnosis.gaps as gap, i (i)}
              {@render finding(
                gap.cause === 'classifierOnly' ? 'warn' : 'fail',
                gapMessage(gap, (id) => story.entryNumberOf(id)),
              )}
            {:else}
              {@render finding(
                'ok',
                'World state changes were recorded for every entry in between.',
              )}
            {/each}
          {/if}
        </ul>
      {/if}
      {#if pastCheckpoint.overrides}
        {@const overrides = pastCheckpoint.overrides}
        <div class="text-muted-foreground text-xs">
          <button
            type="button"
            class="hover:text-foreground flex items-center gap-1 font-medium"
            onclick={() => (advancedOpen = !advancedOpen)}
            aria-expanded={advancedOpen}
            aria-controls="past-checkpoint-advanced"
          >
            {#if advancedOpen}
              <ChevronDown class="h-3.5 w-3.5 shrink-0" />
            {:else}
              <ChevronRight class="h-3.5 w-3.5 shrink-0" />
            {/if}
            Advanced
          </button>
          {#if advancedOpen}
            <div id="past-checkpoint-advanced" class="mt-2 space-y-2 pl-[1.125rem]">
              <label class="flex items-center gap-2">
                <Checkbox
                  checked={overruleGaps}
                  onCheckedChange={(checked) => setOverruleGaps(checked === true)}
                  disabled={saving}
                />
                Create it anyway:
              </label>
              <RadioGroup
                value={gapOverride}
                onValueChange={(v) => (gapOverride = v as GapOverride)}
                disabled={!overruleGaps || saving}
                class="gap-2 pl-6"
              >
                {@render option(
                  'undoRecorded',
                  'Use a partial rollback from the next full state',
                  overrides.next,
                  'Changes that were not recorded stay in.',
                )}
                {@render option('nextAsIs', 'Copy the next full state', overrides.next)}
                {@render option('previousAsIs', 'Copy the previous full state', overrides.previous)}
              </RadioGroup>
            </div>
          {/if}
        </div>
      {/if}
    {:else if pastCheckpoint.source}
      <div class="text-muted-foreground space-y-1 text-xs">
        <p>The world state at this entry is known:</p>
        {#each pastCheckpoint.skipped as position, i (i)}
          <p class="flex items-start gap-1.5">
            <TriangleAlert class="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
            {skippedSnapshotText(position)}
          </p>
        {/each}
        <p class="flex items-start gap-1.5">
          <Check class="mt-px h-3.5 w-3.5 shrink-0 text-green-500" />
          {pastCheckpoint.source.position === entry.position
            ? `${capitalize(anchorText(pastCheckpoint.source))} exists, so no rollback is needed.`
            : `Built by a rollback from ${anchorText(pastCheckpoint.source)}.`}
        </p>
      </div>
    {/if}
    {#if pastCheckpoint && showUndone}
      {#if pastCheckpoint.manual.length + pastCheckpoint.tidy.length > 0}
        <div class="space-y-1">
          {#if pastCheckpoint.manual.length > 0}
            <p class="text-muted-foreground text-xs">
              Changes you made by hand after this entry will not be in the checkpoint:
            </p>
            <ChangeList changes={pastCheckpoint.manual} />
          {/if}
          {#if pastCheckpoint.tidy.length > 0}
            <p class="text-muted-foreground text-xs">
              Changes from lore management you ran after this entry will not be in the checkpoint:
            </p>
            <ChangeList changes={pastCheckpoint.tidy} />
          {/if}
        </div>
      {/if}
      {#if pastCheckpoint.source?.position !== entry.position}
        {#each revertLines(pastCheckpoint.classifier, pastCheckpoint.lore) as line, i (i)}
          <p class="text-muted-foreground text-xs">{line}</p>
        {/each}
      {/if}
    {/if}
  {/if}
</ActionModal>
