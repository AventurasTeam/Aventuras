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
    // Once a second, matching the resolution `formatDuration` shows.
    const handle = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(handle)
  })

  /**
   * Values, not the step: like the timeline's rows, a live step is mutated in place, so the
   * label and detail have to be recomputed rather than read off a held reference.
   */
  let current = $derived.by(() => {
    const step = turn ? activity.deepestRunning(turn) : null
    if (!step) return null
    return {
      label: step.label,
      detail: step.detail ?? '',
      isLLM: step.isLLM,
      time: formatDuration(stepDuration(step, now)),
    }
  })
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

      {#if current}
        {#if current.isLLM}
          <Sparkles class="text-primary/70 h-3 w-3 shrink-0 translate-y-0.5" />
        {/if}
        <span class="text-foreground min-w-0 truncate">{current.label}</span>
        {#if current.detail}
          <span class="text-muted-foreground/60 min-w-0 truncate">· {current.detail}</span>
        {/if}
        <span class="text-primary shrink-0 tabular-nums">{current.time}</span>
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
