<script lang="ts">
  import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui'
  import { cn } from '$lib/utils/cn.js'
  import { NO_SCROLL_LOCK_ATTR } from '$lib/utils/scrollLock'

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: DropdownMenuPrimitive.SubContentProps = $props()
</script>

<!-- A sub-menu never locks the body upstream, but renders the same `role="menu"` as one that
     does, so it has to say so or it would veto orphan recovery while holding nothing. -->
<DropdownMenuPrimitive.SubContent
  bind:ref
  {...{ [NO_SCROLL_LOCK_ATTR]: '' }}
  class={cn(
    'bg-popover text-popover-foreground z-50 min-w-[8rem] rounded-md border p-1 shadow-lg focus:outline-none',
    className,
  )}
  {...restProps}
/>
