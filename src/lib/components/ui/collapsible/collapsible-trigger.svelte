<script lang="ts">
  import { Collapsible as CollapsiblePrimitive } from 'bits-ui'
  import { cn } from '#lib/utils/cn.ts'
  import type { Snippet } from 'svelte'
  import type { ClassValue } from 'clsx'

  let {
    ref = $bindable(null),
    class: className,
    child,
    children,
    ...restProps
  }: CollapsiblePrimitive.TriggerProps & {
    class?: ClassValue
    child?: Snippet<[{ props: Record<string, any> }]>
    children?: Snippet
  } = $props()
</script>

<CollapsiblePrimitive.Trigger
  bind:ref
  class={cn(
    '[&[data-state=open]>text-accent-400] flex items-center justify-center gap-2 text-sm font-medium transition-colors',
    className,
  )}
  {...restProps}
>
  {#if child}
    {@render child({ props: restProps })}
  {:else}
    {@render children?.()}
  {/if}
</CollapsiblePrimitive.Trigger>
