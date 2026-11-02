<!--
  A folding section under a muted summary line. With an `id` it is remembered folded or open
  across stories and sessions; without one, `open` is the caller's. See
  docs/development/ui-components.md.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { ChevronRight } from '@lucide/svelte'
  import * as Collapsible from '#lib/components/ui/collapsible/index.ts'
  import { ui, type ExplanationFoldId } from '#lib/stores/ui.svelte.ts'
  import { cn } from '#lib/utils/cn.ts'

  type Props = {
    summary: string
    class?: string
    children: Snippet
  } & (
    | {
        id: ExplanationFoldId
        open?: never
      }
    | { id?: never; open?: boolean }
  )

  let { id, open = $bindable(true), summary, class: className, children }: Props = $props()

  const shown = $derived(id ? !(ui.explanationFolded.get(id) ?? false) : open)

  function toggle(next: boolean) {
    if (id) void ui.setExplanationFolded(id, !next)
    else open = next
  }
</script>

<Collapsible.Root
  open={shown}
  onOpenChange={toggle}
  class={cn('text-muted-foreground text-xs', className)}
>
  <Collapsible.Trigger class="group hover:text-foreground justify-start gap-1 text-xs">
    <ChevronRight
      class="size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90"
    />
    {summary}
  </Collapsible.Trigger>
  <Collapsible.Content>
    <div class="pt-1 pl-[1.125rem]">
      {@render children()}
    </div>
  </Collapsible.Content>
</Collapsible.Root>
