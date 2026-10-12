<script lang="ts">
  import * as Dialog from '#lib/components/ui/dialog/index.ts'
  import * as Drawer from '#lib/components/ui/drawer/index.ts'
  import { getResponsiveModalContext } from './context'

  let { children, ...props } = $props()
  const { isMobile } = getResponsiveModalContext()
</script>

{#if isMobile.current}
  <Drawer.Close {...props}>
    {@render children?.()}
  </Drawer.Close>
{:else}
  <Dialog.Close {...props}>
    {@render children?.()}
  </Dialog.Close>
{/if}
