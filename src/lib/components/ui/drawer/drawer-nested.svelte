<script lang="ts">
  import { Drawer as DrawerPrimitive } from 'vaul-svelte'
  import { isAndroid } from '#lib/utils/platform.ts'
  import { DRAWER_CLOSE_THRESHOLD } from './swipe-guard'

  // The same defaults as `drawer.svelte`, so a sheet behaves alike whether or not it is nested.
  let {
    shouldScaleBackground = true,
    open = $bindable(false),
    activeSnapPoint = $bindable(null),
    handleOnly = true,
    closeThreshold = DRAWER_CLOSE_THRESHOLD,
    repositionInputs = !isAndroid(),
    ...restProps
  }: DrawerPrimitive.RootProps = $props()
</script>

<DrawerPrimitive.NestedRoot
  {shouldScaleBackground}
  bind:open
  bind:activeSnapPoint
  {handleOnly}
  {closeThreshold}
  {repositionInputs}
  {...restProps}
/>
