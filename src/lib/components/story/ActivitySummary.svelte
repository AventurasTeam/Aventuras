<script lang="ts">
  import { activity } from '$lib/stores/activity.svelte'
  import { formatDuration, rootStep, stepDuration, type ActivityTurn } from '$lib/services/activity'
  import { ChevronRight, Sparkles } from '@lucide/svelte'

  let { turn }: { turn: ActivityTurn } = $props()

  let expanded = $derived(activity.isTreeExpanded(turn))
  let haltReason = $derived(activity.haltReason(turn))

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

<!-- The collapsed line alone, toggling the timeline. Placed by its parent: a finished entry
     sets it beside the story time on a narrow card, with the timeline on a row of its own. -->
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

  <!-- Wraps rather than being cut; the time follows the last word. -->
  <span class="min-w-0 flex-1 break-words">
    {#if current}
      {#if current.root}
        {current.root}
        <span class="text-muted-foreground/50">·</span>
      {/if}
      <span class="text-foreground">{current.label}</span>
      {#if current.detail}
        <span class="text-muted-foreground/60">· {current.detail}</span>
      {/if}
      <span class="text-primary inline-flex items-baseline gap-0.5 whitespace-nowrap tabular-nums">
        {current.time}
        {#if current.isLLM}
          <Sparkles class="h-3 w-3 shrink-0 translate-y-0.5 text-amber-700 dark:text-amber-500" />
        {/if}
      </span>
    {:else if haltReason !== null}
      <span class="text-red-700 dark:text-red-500">Failed</span>
      {#if haltReason}
        · {haltReason}
      {/if}
    {:else}
      {activity.hasEnded(turn) ? 'Finished' : 'Working'}
    {/if}
  </span>
</button>
