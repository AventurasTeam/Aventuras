<script lang="ts">
  import { Drawer as DrawerPrimitive } from 'vaul-svelte'
  import { isAndroid } from '$lib/utils/platform'
  import { DRAWER_CLOSE_THRESHOLD } from './swipe-guard'

  let {
    shouldScaleBackground = true,
    open = $bindable(false),
    activeSnapPoint = $bindable(null),
    handleOnly = true,
    closeThreshold = DRAWER_CLOSE_THRESHOLD,
    // On Android the keyboard shrinks the layout viewport itself; see overview.md, "The soft keyboard".
    repositionInputs = !isAndroid(),
    ...restProps
  }: DrawerPrimitive.RootProps = $props()
</script>

<DrawerPrimitive.Root
  {shouldScaleBackground}
  bind:open
  bind:activeSnapPoint
  {handleOnly}
  {closeThreshold}
  {repositionInputs}
  {...restProps}
/>
