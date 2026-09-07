<script lang="ts">
  import { activity } from '$lib/stores/activity.svelte'
  import { formatDuration, rootStep, stepDuration, type ActivityTurn } from '$lib/services/activity'
  import { ChevronRight, Sparkles } from '@lucide/svelte'
  import ActivityTimeline from './ActivityTimeline.svelte'

  let { turn }: { turn: ActivityTurn } = $props()

  let expanded = $derived(activity.isTreeExpanded(turn.entryId))

  /**
   * Values, not the step: like the timeline's rows, a live step is mutated in place, so the
   * label and detail have to be recomputed rather than read off a held reference.
   *
   * The root is named beside it because the innermost step is the useful one and the least
   * self-explanatory: "Model call 1" does not say what the call is for.
   */
  let current = $derived.by(() => {
    const step = activity.deepestRunning(turn)
    if (!step) return null
    const root = rootStep(turn.steps, step)
    return {
      label: step.label,
      root: root.id === step.id ? '' : root.label,
      detail: step.detail ?? '',
      isLLM: step.isLLM,
      time: formatDuration(stepDuration(step, activity.now)),
    }
  })
</script>

<div class="animate-fade-in">
  <button
    type="button"
    class="text-muted-foreground hover:text-foreground flex w-full items-baseline gap-1.5 text-left text-xs transition-colors"
    aria-expanded={expanded}
    title={expanded ? 'Show only the current step' : 'Show the whole turn'}
    onclick={() => activity.setTreeExpanded(turn.entryId, !expanded)}
  >
    <ChevronRight
      class="h-3 w-3 shrink-0 translate-y-0.5 transition-transform {expanded ? 'rotate-90' : ''}"
    />

    {#if current}
      {#if current.isLLM}
        <Sparkles class="text-primary/70 h-3 w-3 shrink-0 translate-y-0.5" />
      {/if}
      {#if current.root}
        <span class="shrink-0">{current.root}</span>
        <span class="text-muted-foreground/50 shrink-0">·</span>
      {/if}
      <span class="text-foreground min-w-0 truncate">{current.label}</span>
      {#if current.detail}
        <span class="text-muted-foreground/60 min-w-0 truncate">· {current.detail}</span>
      {/if}
      <span class="text-primary shrink-0 tabular-nums">{current.time}</span>
    {:else}
      <span class="min-w-0 truncate">{turn.endedAt ? 'Finished' : 'Working'}</span>
    {/if}
  </button>

  {#if expanded}
    <ActivityTimeline {turn} now={activity.now} />
  {/if}
</div>
