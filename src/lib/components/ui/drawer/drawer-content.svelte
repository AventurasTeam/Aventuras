<script lang="ts">
  import { Drawer as DrawerPrimitive } from 'vaul-svelte'
  import DrawerOverlay from './drawer-overlay.svelte'
  import DrawerHandle from './drawer-handle.svelte'
  import { cn } from '#lib/utils/cn.ts'

  let {
    ref = $bindable(null),
    class: className,
    portalProps,
    children,
    ...restProps
  }: DrawerPrimitive.ContentProps & {
    portalProps?: DrawerPrimitive.PortalProps
  } = $props()
</script>

<DrawerPrimitive.Portal {...portalProps}>
  <DrawerOverlay />
  <DrawerPrimitive.Content
    bind:ref
    class={cn(
      'bg-background fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-[10px] border',
      className,
    )}
    {...restProps}
  >
    <DrawerHandle />
    {@render children?.()}
  </DrawerPrimitive.Content>
</DrawerPrimitive.Portal>
