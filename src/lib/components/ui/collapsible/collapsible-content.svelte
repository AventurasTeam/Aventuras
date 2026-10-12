<script lang="ts">
  import { Collapsible as CollapsiblePrimitive } from 'bits-ui'
  import { cn } from '#lib/utils/cn.ts'
  import type { ClassValue } from 'clsx'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: CollapsiblePrimitive.ContentProps & { class?: ClassValue } = $props()
</script>

<CollapsiblePrimitive.Content
  bind:ref
  class={cn(
    'data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</CollapsiblePrimitive.Content>
