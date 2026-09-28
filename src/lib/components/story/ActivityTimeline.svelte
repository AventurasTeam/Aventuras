<script lang="ts">
  import { activity } from '$lib/stores/activity.svelte'
  import {
    flattenTree,
    formatDuration,
    stepDuration,
    type ActivityTurn,
  } from '$lib/services/activity'
  import { Sparkles } from '@lucide/svelte'

  let { turn, now }: { turn: ActivityTurn; now: number } = $props()

  /**
   * Rows carry values, not steps. A step is a plain object mutated in place -- its `detail`
   * moves while it runs -- so a row holding the reference renders whatever it read first,
   * however often the tree is rebuilt around it. Recomputing primitives is what puts a
   * revised detail on screen.
   */
  let rows = $derived(
    flattenTree(activity.tree(turn)).map(({ step, level }) => ({
      id: step.id,
      level,
      label: step.label,
      detail: step.detail ?? '',
      isLLM: step.isLLM,
      running: step.status === 'running',
      skipped: step.status === 'skipped',
      failed: step.status === 'failed',
      time: formatDuration(stepDuration(step, now)),
    })),
  )
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
        class="inline-flex w-12 shrink-0 items-baseline justify-end tabular-nums"
        class:text-muted-foreground={!row.running}
        class:text-primary={row.running}
      >
        {#if row.isLLM}
          <Sparkles
            class="mr-1 h-2.5 w-2.5 shrink-0 translate-y-px text-amber-700 dark:text-amber-500"
          />
        {/if}
        {row.time}
      </span>

      <!-- One colour per outcome, never two: same-property utilities are resolved by the order
           Tailwind emits them, not the order written, and muted is emitted after destructive. -->
      <span
        class="min-w-0 truncate"
        class:text-foreground={row.running}
        class:text-destructive={row.failed}
        class:text-muted-foreground={!row.running && !row.failed}
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
  {:else}
    <p class="text-muted-foreground py-0.5 text-[11px]">Nothing recorded yet.</p>
  {/each}
</div>
