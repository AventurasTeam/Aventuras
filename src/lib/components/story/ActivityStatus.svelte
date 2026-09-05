<script lang="ts">
  import { activity } from '$lib/stores/activity.svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import {
    formatDuration,
    stepDuration,
    turnDuration,
    type ActivityTurn,
  } from '$lib/services/activity'
  import { ChevronRight, Sparkles } from '@lucide/svelte'
  import ActivityTimeline from './ActivityTimeline.svelte'

  let { turn }: { turn: ActivityTurn | null } = $props()

  let expanded = $state(settings.uiSettings.activityReporting === 'tree')

  /**
   * Drives the elapsed times. A step that never ends would otherwise report the duration it
   * had when the last event landed, which is exactly the case a stalled turn presents.
   */
  let now = $state(Date.now())
  $effect(() => {
    if (!turn || turn.endedAt) return
    const handle = setInterval(() => (now = Date.now()), 100)
    return () => clearInterval(handle)
  })

  let running = $derived(turn ? activity.deepestRunning(turn) : null)
</script>

{#if turn}
  <div class="animate-fade-in">
    <button
      type="button"
      class="text-muted-foreground hover:text-foreground flex w-full items-baseline gap-1.5 text-left text-xs transition-colors"
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      <ChevronRight
        class="h-3 w-3 shrink-0 translate-y-0.5 transition-transform {expanded ? 'rotate-90' : ''}"
      />

      {#if running}
        {#if running.isLLM}
          <Sparkles class="text-primary/70 h-3 w-3 shrink-0 translate-y-0.5" />
        {/if}
        <span class="text-foreground min-w-0 truncate">{running.label}</span>
        {#if running.detail}
          <span class="text-muted-foreground/60 min-w-0 truncate">· {running.detail}</span>
        {/if}
        <span class="text-primary shrink-0 tabular-nums"
          >{formatDuration(stepDuration(running, now))}</span
        >
      {:else}
        <span class="min-w-0 truncate">{turn.endedAt ? 'Finished' : 'Working'}</span>
      {/if}

      <span class="flex-1"></span>
      <span class="shrink-0 tabular-nums">{formatDuration(turnDuration(turn, now))}</span>
    </button>

    {#if expanded}
      <ActivityTimeline {turn} {now} />
    {/if}
  </div>
{/if}
