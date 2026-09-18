<script lang="ts">
  import { Drawer as DrawerPrimitive } from 'vaul-svelte'

  let {
    shouldScaleBackground = true,
    open = $bindable(false),
    activeSnapPoint = $bindable(null),
    handleOnly = true,
    closeThreshold = 0.75,
    // The keyboard shrinks the layout viewport itself; see overview.md, "The soft keyboard".
    repositionInputs = false,
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
