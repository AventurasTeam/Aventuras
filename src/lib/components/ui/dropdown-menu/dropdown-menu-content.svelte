<script lang="ts">
  import { cn } from '$lib/utils/cn.js'
  import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui'
  import { NO_SCROLL_LOCK_ATTR } from '$lib/utils/scrollLock'

  let {
    ref = $bindable(null),
    sideOffset = 4,
    portalProps,
    class: className,
    // `bits-ui` resolves `preventScroll ?? true`, so a dropdown locks the body unless told not
    // to. `strategy` is derived from it upstream, and is pinned so opting out leaves position
    // unchanged.
    preventScroll = false,
    strategy = 'fixed',
    ...restProps
  }: DropdownMenuPrimitive.ContentProps & {
    portalProps?: DropdownMenuPrimitive.PortalProps
  } = $props()
</script>

<DropdownMenuPrimitive.Portal {...portalProps}>
  <DropdownMenuPrimitive.Content
    bind:ref
    {sideOffset}
    {preventScroll}
    {strategy}
    {...preventScroll ? {} : { [NO_SCROLL_LOCK_ATTR]: '' }}
    class={cn(
      'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-md border p-1 shadow-md outline-none',
      className,
    )}
    {...restProps}
  />
</DropdownMenuPrimitive.Portal>
