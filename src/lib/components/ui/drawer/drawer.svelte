<script lang="ts">
  import { Drawer as DrawerPrimitive } from 'vaul-svelte'
  import { isAndroid, isIos } from '#lib/utils/platform.ts'

  let {
    shouldScaleBackground = true,
    open = $bindable(false),
    activeSnapPoint = $bindable(null),
    handleOnly = true,
    closeThreshold = 0.75,
    // Android shrinks the layout viewport itself and iOS has `--keyboard-inset`; see overview.md, "The soft keyboard".
    repositionInputs = !isAndroid() && !isIos(),
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
