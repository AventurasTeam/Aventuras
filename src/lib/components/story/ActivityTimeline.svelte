<script lang="ts">
  import { activity } from '$lib/stores/activity.svelte'
  import {
    failuresShownBelow,
    stepsAboveFailures,
    flattenTree,
    formatDuration,
    stepDuration,
    type ActivityTurn,
  } from '$lib/services/activity'
  import { Sparkles, TriangleAlert } from '@lucide/svelte'

  let { turn, now }: { turn: ActivityTurn; now: number } = $props()

  /**
   * Rows carry values, not steps. A step is a plain object mutated in place -- its `detail`
   * moves while it runs -- so a row holding the reference renders whatever it read first,
   * however often the tree is rebuilt around it. Recomputing primitives is what puts a
   * revised detail on screen.
   */
  let rows = $derived.by(() => {
    const nodes = activity.tree(turn)
    const shownBelow = failuresShownBelow(nodes)
    const aboveFailures = stepsAboveFailures(nodes)
    return flattenTree(nodes).map(({ step, level }) => ({
      id: step.id,
      level,
      label: step.label,
      detail: step.detail ?? '',
      isLLM: step.isLLM,
      running: step.status === 'running',
      skipped: step.status === 'skipped',
      // A failure is told once, on the deepest step that carries it. Every step above one is
      // marked, unless it is itself shown as failed, so the way down to it can be followed.
      failed: step.status === 'failed' && !shownBelow.has(step.id),
      failedBelow:
        aboveFailures.has(step.id) && !(step.status === 'failed' && !shownBelow.has(step.id)),
      time: formatDuration(stepDuration(step, now)),
      error: shownBelow.has(step.id) ? '' : (step.error ?? ''),
    }))
  })
</script>

<!-- Uncapped, like the reasoning block: a long turn is read by scrolling the story, not through
     a window of its own. While the narration streams few steps run beside it, so the report
     rarely grows under the reader. -->
<div class="border-border/50 bg-muted/30 mt-1 rounded-md border px-2 py-1.5">
  {#each rows as row (row.id)}
    <div
      class="flex items-baseline gap-1.5 py-0.5 text-[11px] leading-tight"
      style="padding-left: {row.level * 0.75}rem"
    >
      <!-- Fixed width, so the labels start in one column. -->
      <span
        class="inline-flex w-14 shrink-0 items-baseline justify-end whitespace-nowrap tabular-nums"
        class:text-muted-foreground={!row.running}
        class:text-primary={row.running}
      >
        {#if row.failedBelow}
          <TriangleAlert
            class="mr-1 h-2.5 w-2.5 shrink-0 translate-y-px text-red-700 dark:text-red-500"
          />
        {/if}
        {#if row.isLLM}
          <Sparkles
            class="mr-1 h-2.5 w-2.5 shrink-0 translate-y-px text-amber-700 dark:text-amber-500"
          />
        {/if}
        {row.time}
      </span>

      <!-- One colour per outcome, never two: same-property utilities are resolved by the order
           Tailwind emits them, not the order written. Literal red: `--destructive` is too dark
           for text on several themes. -->
      <span
        class="min-w-0 truncate {row.failed
          ? 'text-red-700 dark:text-red-500'
          : row.running
            ? 'text-foreground'
            : 'text-muted-foreground'}"
        class:line-through={row.skipped}
      >
        {row.label}
      </span>

      {#if row.detail}
        <span class="text-muted-foreground/60 min-w-0 truncate">· {row.detail}</span>
      {/if}

      {#if row.running}
        <span class="text-primary/60 shrink-0">…</span>
      {/if}
    </div>
    {#if row.error}
      <!-- Indented to the label (level, plus the time column and its gap), and wrapped: a reason
           is read in full. -->
      <p
        class="pb-0.5 text-[11px] leading-snug break-words text-red-700 dark:text-red-500"
        style="padding-left: {row.level * 0.75 + 3.875}rem"
      >
        {row.error}
      </p>
    {/if}
  {:else}
    <p class="text-muted-foreground py-0.5 text-[11px]">Nothing recorded yet.</p>
  {/each}
</div>
