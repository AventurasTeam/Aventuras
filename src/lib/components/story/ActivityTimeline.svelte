<script lang="ts">
  import { activity } from '$lib/stores/activity.svelte'
  import { flattenTree, formatStepDuration, type ActivityTurn } from '$lib/services/activity'
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
      time: formatStepDuration(step, now) ?? '',
    })),
  )
</script>

<!-- Capped: a deep retrieval run is tens of rows, and the report must not push the
     narration off the screen to show them. -->
<div
  class="border-border/50 bg-muted/30 mt-1 max-h-64 overflow-y-auto rounded-md border px-2 py-1.5"
>
  {#each rows as row (row.id)}
    <div
      class="flex items-baseline gap-1.5 py-0.5 text-[11px] leading-tight"
      style="padding-left: {row.level * 0.75}rem"
    >
      <!-- Fixed width: the column stays a column when a step has no measured duration. -->
      <span
        class="w-11 shrink-0 text-right tabular-nums"
        class:text-muted-foreground={!row.running}
        class:text-primary={row.running}
      >
        {row.time}
      </span>

      {#if row.isLLM}
        <Sparkles class="text-primary/70 h-2.5 w-2.5 shrink-0 translate-y-px" />
      {/if}

      <span
        class="min-w-0 truncate"
        class:text-foreground={row.running}
        class:text-muted-foreground={!row.running}
        class:line-through={row.skipped}
        class:text-destructive={row.failed}
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
