<script lang="ts">
  import type { WorldStateChangeRecord } from '#lib/types/index.ts'
  import ChangeList from './ChangeList.svelte'

  /** What a revert does besides, line by line, then the changes it undoes too, by origin. */
  let {
    lines = [],
    heading,
    manual = [],
    tidy = [],
    deletedChapters = [],
  }: {
    lines?: string[]
    heading: string
    manual?: WorldStateChangeRecord[]
    tidy?: WorldStateChangeRecord[]
    deletedChapters?: WorldStateChangeRecord[]
  } = $props()

  const groups = $derived(
    [
      { label: 'Changes you made by hand:', changes: manual },
      { label: 'Changes from lore management you ran:', changes: tidy },
      { label: "Changes from a deleted chapter's lore management:", changes: deletedChapters },
    ].filter((group) => group.changes.length > 0),
  )
</script>

{#if lines.length > 0}
  <div class="space-y-1">
    {#each lines as line, i (i)}
      <p class="text-muted-foreground text-sm">{line}</p>
    {/each}
  </div>
{/if}
{#if groups.length > 0}
  <div class="space-y-1">
    <p class="text-muted-foreground text-sm">{heading}</p>
    {#each groups as group (group.label)}
      <p class="text-muted-foreground text-xs">{group.label}</p>
      <ChangeList changes={group.changes} />
    {/each}
  </div>
{/if}
