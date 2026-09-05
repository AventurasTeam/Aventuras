<script lang="ts">
  import { activity } from '$lib/stores/activity.svelte'
  import {
    formatDuration,
    stepDuration,
    type ActivityNode,
    type ActivityTurn,
  } from '$lib/services/activity'
  import { Sparkles } from '@lucide/svelte'

  let { turn, now, depth = 0 }: { turn: ActivityTurn; now: number; depth?: number } = $props()

  let nodes = $derived(activity.tree(turn))
</script>

{#snippet row(node: ActivityNode, level: number)}
  {@const step = node.step}
  <div
    class="flex items-baseline gap-1.5 py-0.5 text-[11px] leading-tight"
    style="padding-left: {level * 0.75}rem"
  >
    <span
      class="shrink-0 tabular-nums"
      class:text-muted-foreground={step.status !== 'running'}
      class:text-primary={step.status === 'running'}
    >
      {formatDuration(stepDuration(step, now))}
    </span>

    {#if step.isLLM}
      <Sparkles class="text-primary/70 h-2.5 w-2.5 shrink-0 translate-y-px" />
    {/if}

    <span
      class="min-w-0 truncate"
      class:text-foreground={step.status === 'running'}
      class:text-muted-foreground={step.status !== 'running'}
      class:line-through={step.status === 'skipped'}
      class:text-destructive={step.status === 'failed'}
    >
      {step.label}
    </span>

    {#if step.detail}
      <span class="text-muted-foreground/60 min-w-0 truncate">· {step.detail}</span>
    {/if}

    {#if step.status === 'running'}
      <span class="text-primary/60 shrink-0">…</span>
    {/if}
  </div>

  {#each node.children as child (child.step.id)}
    {@render row(child, level + 1)}
  {/each}
{/snippet}

<!-- Capped: a deep retrieval run is tens of rows, and the report must not push the
     narration off the screen to show them. -->
<div
  class="border-border/50 bg-muted/30 mt-1 max-h-64 overflow-y-auto rounded-md border px-2 py-1.5"
>
  {#each nodes as node (node.step.id)}
    {@render row(node, depth)}
  {:else}
    <p class="text-muted-foreground py-0.5 text-[11px]">Nothing recorded yet.</p>
  {/each}
</div>
