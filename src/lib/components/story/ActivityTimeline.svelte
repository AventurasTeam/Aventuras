<script lang="ts">
  import { activity } from '$lib/stores/activity.svelte'
  import {
    failuresShownBelow,
    failureMarks,
    stepsHoldingAttempts,
    flattenTree,
    formatStepDuration,
    type ActivityTurn,
  } from '$lib/services/activity'
  import { Sparkles, TriangleAlert } from '@lucide/svelte'

  let { turn, now }: { turn: ActivityTurn; now: number } = $props()

  /**
   * Rows carry values, not steps. A step is a plain object mutated in place -- its `detail`
   * moves while it runs -- so a row holding the reference renders whatever it read first,
   * however often the tree is rebuilt around it. Recomputing primitives is what puts a
   * revised detail on screen. The tree is read once per recorded change; only the times follow
   * the clock.
   */
  let analysed = $derived.by(() => {
    const nodes = activity.tree(turn)
    const shownBelow = failuresShownBelow(nodes)
    const marks = failureMarks(nodes)
    const holding = stepsHoldingAttempts(nodes)
    return flattenTree(nodes).map(({ step, level }) => {
      const failed = step.status === 'failed' && !shownBelow.has(step.id)
      return {
        id: step.id,
        level,
        label: step.label,
        detail: step.detail ?? '',
        // On the calls themselves: not on a request that turned out to hold several attempts.
        isLLM: step.isLLM && !holding.has(step.id),
        running: step.status === 'running',
        skipped: step.status === 'skipped',
        failed,
        mark: failed ? null : (marks.get(step.id) ?? null),
        error: shownBelow.has(step.id) ? '' : (step.error ?? ''),
        timing: { startedAt: step.startedAt, endedAt: step.endedAt, untimed: step.untimed },
      }
    })
  })

  let rows = $derived(
    analysed.map((row) => ({
      ...row,
      time: formatStepDuration(row.timing, now),
    })),
  )
</script>

<div class="border-border/50 bg-muted/30 mt-1 rounded-md border px-2 py-1.5">
  {#each rows as row (row.id)}
    <div
      class="flex items-baseline gap-1.5 py-0.5 text-[11px] leading-tight"
      style="padding-left: {row.level * 0.75}rem"
    >
      <!-- Fixed width even when empty: the column is part of the indent, so the labels of one
           level start together. -->
      <span
        class="inline-flex w-14 shrink-0 items-baseline justify-end whitespace-nowrap tabular-nums"
        class:text-muted-foreground={!row.running}
        class:text-primary={row.running}
      >
        {#if row.mark === 'failed'}
          <TriangleAlert
            class="mr-1 h-2.5 w-2.5 shrink-0 translate-y-px text-red-700 dark:text-red-500"
          />
        {:else if row.mark === 'recovered'}
          <TriangleAlert class="text-foreground mr-1 h-2.5 w-2.5 shrink-0 translate-y-px" />
        {/if}
        {#if row.isLLM}
          <Sparkles
            class="mr-1 h-2.5 w-2.5 shrink-0 translate-y-px text-amber-700 dark:text-amber-500"
          />
        {/if}
        {row.time}
      </span>

      <!-- Wrapped, not cut: label, detail and the running ellipsis flow as one text. One colour
           per outcome, never two: same-property utilities are resolved by the order Tailwind
           emits them, not the order written. Literal red: `--destructive` is too dark for text
           on several themes. -->
      <span class="min-w-0 flex-1 break-words">
        <span
          class={row.failed
            ? 'text-red-700 dark:text-red-500'
            : row.running
              ? 'text-foreground'
              : 'text-muted-foreground'}
          class:line-through={row.skipped}>{row.label}</span
        >{#if row.detail}<span class="text-muted-foreground/60">
            · {row.detail}</span
          >{/if}{#if row.running}<span class="text-primary/60"> …</span>{/if}
      </span>
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
