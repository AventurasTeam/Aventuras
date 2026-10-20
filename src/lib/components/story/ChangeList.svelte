<script lang="ts">
  import type { WorldStateChangeRecord } from '#lib/types/index.ts'
  import { describeChange } from '#lib/services/stateTracking/index.ts'
  import { story } from '#lib/stores/story.svelte.ts'

  let {
    changes,
    unkeepable,
  }: { changes: WorldStateChangeRecord[]; unkeepable: WorldStateChangeRecord[] } = $props()

  const lost = $derived(new Set(unkeepable.map((r) => r.id)))
</script>

<ul class="text-muted-foreground list-disc pl-5 text-xs">
  {#each changes as change (change.id)}
    <li>
      {describeChange(change, (type, id) => story.trackedName(type, id))}
      {#if lost.has(change.id)}
        <span class="text-amber-500">— will not be kept: what it changed will be gone</span>
      {/if}
    </li>
  {/each}
</ul>
