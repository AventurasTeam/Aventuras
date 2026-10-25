<!--
  A folding explanation of how something works, remembered folded or open across stories and
  sessions. See docs/development/ui-components.md.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { ChevronDown, ChevronRight } from '@lucide/svelte'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { cn } from '#lib/utils/cn.ts'

  interface Props {
    /** Names the saved fold state, so it must not be shared with another explanation. */
    id: string
    summary: string
    class?: string
    children: Snippet
  }

  let { id, summary, class: className, children }: Props = $props()

  const uid = $props.id()
  const folded = $derived(ui.explanationFolded.get(id) ?? false)
</script>

<div class={cn('text-muted-foreground text-xs', className)}>
  <button
    type="button"
    class="hover:text-foreground flex items-center gap-1 font-medium"
    aria-expanded={!folded}
    aria-controls="{uid}-explanation"
    onclick={() => void ui.setExplanationFolded(id, !folded)}
  >
    {#if folded}
      <ChevronRight class="h-3.5 w-3.5 shrink-0" />
    {:else}
      <ChevronDown class="h-3.5 w-3.5 shrink-0" />
    {/if}
    {summary}
  </button>
  {#if !folded}
    <div id="{uid}-explanation" class="mt-1 pl-[1.125rem]">
      {@render children()}
    </div>
  {/if}
</div>
