<script lang="ts">
  import type { WorldStateChangeRecord } from '#lib/types/index.ts'
  import { describeChange } from '#lib/services/stateTracking/index.ts'
  import { story } from '#lib/stores/story.svelte.ts'

  let { changes }: { changes: WorldStateChangeRecord[] } = $props()
</script>

<ul class="text-muted-foreground list-disc pl-5 text-xs">
  {#each changes as change (change.id)}
    <li>{describeChange(change, (type, id) => story.trackedName(type, id))}</li>
  {/each}
</ul>
