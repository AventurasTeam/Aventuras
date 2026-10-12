<script lang="ts">
  import * as Dialog from '#lib/components/ui/dialog/index.ts'
  import * as Drawer from '#lib/components/ui/drawer/index.ts'
  import { getResponsiveModalContext } from './context'

  let { children, ...props } = $props()
  const { isMobile } = getResponsiveModalContext()
</script>

{#if isMobile.current}
  <Drawer.Trigger {...props}>
    {@render children?.()}
  </Drawer.Trigger>
{:else}
  <Dialog.Trigger {...props}>
    {@render children?.()}
  </Dialog.Trigger>
{/if}
