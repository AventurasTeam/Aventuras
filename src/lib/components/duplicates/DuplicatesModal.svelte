<script lang="ts">
  /**
   * The duplicate worklist, one group at a time.
   *
   * The unit of work is a *group*, not an entity: resolving one means comparing its members
   * side by side and picking which name survives, and grouping is transitive, so three
   * titles for one person are one decision rather than three.
   *
   * Pools are ordered by where duplicates pile up — world state first, since the classifier
   * mints a new `Character` for each new title; the lorebook last.
   */
  import {
    findAllDuplicates,
    buildMergePlan,
    mergeGroup,
    keepSeparate,
    forgetKeptSeparate,
    APPEND,
    type MergePlan,
  } from '$lib/services/generation'
  import type { EntityDuplicateGroup } from '$lib/services/duplicates'
  import { story } from '$lib/stores/story.svelte'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { Badge } from '$lib/components/ui/badge'
  import {
    Merge,
    SplitSquareHorizontal,
    Loader2,
    CheckCircle2,
    RotateCcw,
    TriangleAlert,
    ArrowLeft,
  } from '@lucide/svelte'

  interface Props {
    onClose: () => void
  }

  let { onClose }: Props = $props()

  let groups = $state<EntityDuplicateGroup[]>([])
  let loading = $state(true)
  let busyKey = $state<string | null>(null)
  /** Which member the user has chosen to keep, per group. Defaults to the first. */
  let primaryByGroup = $state<Record<string, string>>({})
  /**
   * The group being previewed, and what merging it would write.
   *
   * A merge deletes rows and is not undoable, so it never runs straight off the button:
   * the plan is shown first, with every field's origin, and the fields the two rows
   * disagree on are picked here rather than guessed.
   */
  let previewKey = $state<string | null>(null)
  let plan = $state<MergePlan | null>(null)
  /**
   * The last operation's failure, shown rather than swallowed.
   *
   * A merge writes and deletes rows; a merge that half-failed and reported nothing leaves
   * the user believing a group was consolidated when it was not, and the window looks the
   * same either way.
   */
  let error = $state<string | null>(null)

  const failed = (err: unknown) => (error = err instanceof Error ? err.message : String(err))

  const POOL_LABELS: Record<EntityDuplicateGroup['pool'], string> = {
    character: 'Character',
    location: 'Location',
    item: 'Item',
    lorebook: 'Lorebook',
  }

  const REASON_LABELS: Record<EntityDuplicateGroup['reason'], string> = {
    'same-name': 'identical names',
    'shared-alias': 'shared name or alias',
    contained: 'one name contains the other',
    similar: 'near-identical spelling',
  }

  async function refresh() {
    loading = true
    error = null
    try {
      groups = await findAllDuplicates()
      primaryByGroup = Object.fromEntries(
        groups.map((g) => [g.key, primaryByGroup[g.key] ?? g.entities[0].id]),
      )
    } catch (err) {
      failed(err)
    } finally {
      loading = false
    }
  }

  /** What the user sees under a name, so two rows can actually be told apart. */
  function detail(group: EntityDuplicateGroup, id: string): string {
    if (group.pool === 'character') {
      const c = story.characters.find((x) => x.id === id)
      if (!c) return ''
      return [c.status !== 'active' ? c.status : '', c.relationship, c.description]
        .filter(Boolean)
        .join(' · ')
    }
    if (group.pool === 'location') {
      return story.locations.find((x) => x.id === id)?.description ?? ''
    }
    if (group.pool === 'item') {
      return story.items.find((x) => x.id === id)?.description ?? ''
    }
    return story.lorebookEntries.find((x) => x.id === id)?.description ?? ''
  }

  const ORIGIN_LABELS: Record<string, string> = {
    only: 'only this one has it',
    agreed: 'both say the same',
    union: 'combined',
    conflict: 'they disagree',
  }

  function openPreview(group: EntityDuplicateGroup) {
    plan = buildMergePlan(group, primaryByGroup[group.key])
    previewKey = plan ? group.key : null
  }

  function closePreview() {
    previewKey = null
    plan = null
  }

  async function confirmMerge(group: EntityDuplicateGroup) {
    if (!plan) return
    busyKey = group.key
    error = null
    try {
      await mergeGroup(group, plan)
      closePreview()
      await refresh()
    } catch (err) {
      failed(err)
    } finally {
      busyKey = null
    }
  }

  async function onKeepSeparate(group: EntityDuplicateGroup) {
    busyKey = group.key
    error = null
    try {
      await keepSeparate(group)
      await refresh()
    } catch (err) {
      failed(err)
    } finally {
      busyKey = null
    }
  }

  void refresh()

  async function onForget() {
    loading = true
    error = null
    try {
      await forgetKeptSeparate()
      await refresh()
    } catch (err) {
      failed(err)
    } finally {
      loading = false
    }
  }
</script>

<ResponsiveModal.Root open={true} onOpenChange={(open) => !open && !busyKey && onClose()}>
  <ResponsiveModal.Content class="flex max-h-[88vh] max-w-2xl flex-col gap-0 p-0">
    <ResponsiveModal.Header class="border-b px-4 py-4">
      <ResponsiveModal.Title class="flex items-center gap-2">
        <Merge class="h-4 w-4 text-purple-500" />
        Possible duplicates
      </ResponsiveModal.Title>
      <ResponsiveModal.Description>
        Names that look like one subject. Merging keeps the entry you pick and folds the others into
        it; keeping them apart is remembered, so you are not asked again.
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>

    <ScrollArea class="flex-1">
      <div class="space-y-3 p-4">
        {#if error}
          <div
            class="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs"
          >
            {error}
          </div>
        {/if}
        {#if loading}
          <div class="text-muted-foreground flex items-center gap-2 py-8 text-sm">
            <Loader2 class="h-4 w-4 animate-spin" />
            Looking for duplicates…
          </div>
        {:else if groups.length === 0}
          <div class="text-muted-foreground flex flex-col items-center gap-2 py-10 text-sm">
            <CheckCircle2 class="h-6 w-6 text-emerald-500" />
            <p>Nothing left to resolve on this branch.</p>
          </div>
        {:else if previewKey && plan}
          {@const activePlan = plan}
          {@const group = groups.find((g) => g.key === previewKey)!}
          <div class="space-y-3">
            <p class="text-muted-foreground text-xs leading-relaxed">
              Keeping <span class="text-foreground font-medium"
                >{group.entities.find((e) => e.id === activePlan.primaryId)?.name}</span
              >
              and removing {activePlan.absorbing.join(', ')}. This cannot be undone.
            </p>

            {#each activePlan.fields as field (field.key)}
              <div class="bg-muted/20 space-y-2 rounded-lg border p-3">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium">{field.label}</span>
                  {#if field.origin === 'conflict'}
                    <Badge variant="destructive" class="gap-1 text-[10px]">
                      <TriangleAlert class="h-3 w-3" />
                      {ORIGIN_LABELS.conflict}
                    </Badge>
                  {:else}
                    <span class="text-muted-foreground text-[11px]">
                      {ORIGIN_LABELS[field.origin]}
                    </span>
                  {/if}
                </div>

                {#if field.origin === 'conflict'}
                  <div class="space-y-1">
                    {#each field.candidates as candidate, index (candidate.display + index)}
                      <label class="hover:bg-muted/40 flex cursor-pointer gap-2 rounded p-1">
                        <input
                          type="radio"
                          class="mt-1 shrink-0"
                          name={`field-${field.key}`}
                          checked={field.chosen === index}
                          onchange={() => (field.chosen = index)}
                        />
                        <span class="min-w-0">
                          <span class="text-xs">{candidate.display}</span>
                          <span class="text-muted-foreground block text-[10px]">
                            from “{candidate.from}”
                          </span>
                        </span>
                      </label>
                    {/each}
                    {#if field.appendable}
                      <!-- The third answer, and often the right one: neither value is
                           wrong, they were written about the same subject at different
                           times. -->
                      <label class="hover:bg-muted/40 flex cursor-pointer gap-2 rounded p-1">
                        <input
                          type="radio"
                          class="mt-1 shrink-0"
                          name={`field-${field.key}`}
                          checked={field.chosen === APPEND}
                          onchange={() => (field.chosen = APPEND)}
                        />
                        <span class="text-xs">Keep both, one after the other</span>
                      </label>
                    {/if}
                  </div>
                {:else}
                  <p class="text-muted-foreground line-clamp-3 text-xs">{field.display}</p>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          {#each groups as group (group.key)}
            <div class="bg-muted/20 space-y-3 rounded-lg border p-3">
              <div class="flex items-center gap-2">
                <Badge variant="secondary" class="text-[10px]">{POOL_LABELS[group.pool]}</Badge>
                <span class="text-muted-foreground text-[11px]">
                  {REASON_LABELS[group.reason]}
                </span>
              </div>

              <!--
                A radio, not a dropdown: the choice of which name survives is the decision,
                and it has to be visible next to the text that justifies it.
              -->
              <div class="space-y-1.5">
                {#each group.entities as entity (entity.id)}
                  <label
                    class="hover:bg-muted/40 flex cursor-pointer items-start gap-2 rounded-md p-1.5"
                  >
                    <input
                      type="radio"
                      class="mt-1 shrink-0"
                      name={`primary-${group.key}`}
                      value={entity.id}
                      checked={primaryByGroup[group.key] === entity.id}
                      onchange={() => (primaryByGroup[group.key] = entity.id)}
                    />
                    <span class="min-w-0">
                      <span class="text-sm font-medium">{entity.name}</span>
                      {#if detail(group, entity.id)}
                        <span class="text-muted-foreground block truncate text-xs">
                          {detail(group, entity.id)}
                        </span>
                      {/if}
                    </span>
                  </label>
                {/each}
              </div>

              <div class="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyKey !== null}
                  onclick={() => void onKeepSeparate(group)}
                >
                  <SplitSquareHorizontal class="h-3.5 w-3.5" />
                  Keep separate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyKey !== null}
                  onclick={() => openPreview(group)}
                >
                  <Merge class="h-3.5 w-3.5" />
                  Review merge
                </Button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </ScrollArea>

    <ResponsiveModal.Footer class="border-t px-4 py-3">
      {#if previewKey && plan}
        {@const group = groups.find((g) => g.key === previewKey)!}
        <Button variant="ghost" size="sm" disabled={busyKey !== null} onclick={closePreview}>
          <ArrowLeft class="h-3.5 w-3.5" />
          Back
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={busyKey !== null}
          onclick={() => void confirmMerge(group)}
        >
          {#if busyKey === previewKey}
            <Loader2 class="h-3.5 w-3.5 animate-spin" />
          {:else}
            <Merge class="h-3.5 w-3.5" />
          {/if}
          Merge
        </Button>
      {:else}
        <Button variant="ghost" size="sm" disabled={loading} onclick={() => void onForget()}>
          <RotateCcw class="h-3.5 w-3.5" />
          Forget dismissals
        </Button>
        <Button variant="secondary" size="sm" disabled={busyKey !== null} onclick={onClose}>
          Done
        </Button>
      {/if}
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
