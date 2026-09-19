<script lang="ts">
  import { Drawer as DrawerPrimitive } from 'vaul-svelte'
  import { isAndroid } from '$lib/utils/platform'

  let {
    shouldScaleBackground = true,
    open = $bindable(false),
    activeSnapPoint = $bindable(null),
    handleOnly = true,
    closeThreshold = 0.75,
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
