<script lang="ts">
  import { Collapsible as CollapsiblePrimitive } from 'bits-ui'
  import { cn } from '#lib/utils/cn.ts'
  import type { ClassValue } from 'svelte/elements'

  let {
    ref = $bindable(null),
    open = $bindable(false),
    class: className,
    ...restProps
  }: CollapsiblePrimitive.RootProps & { class?: ClassValue } = $props()
</script>

<CollapsiblePrimitive.Root bind:ref bind:open class={cn(className)} {...restProps} />
