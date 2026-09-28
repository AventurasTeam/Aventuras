<script lang="ts">
  import { activity } from '$lib/stores/activity.svelte'
  import type { ActivityTurn } from '$lib/services/activity'
  import ActivitySummary from './ActivitySummary.svelte'
  import ActivityTimeline from './ActivityTimeline.svelte'

  let { turn }: { turn: ActivityTurn } = $props()

  let expanded = $derived(activity.isTreeExpanded(turn))
</script>

<!-- The line with its timeline beneath, for a parent with nothing to set beside the line. -->
<div class="animate-fade-in">
  <ActivitySummary {turn} />

  {#if expanded}
    <ActivityTimeline {turn} now={activity.now} />
  {/if}
</div>
