<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import * as Drawer from '$lib/components/ui/drawer'
  import { getResponsiveModalContext } from './context'
  import { cn } from '$lib/utils/cn'

  let { children, class: className, ...props } = $props()
  const { isMobile } = getResponsiveModalContext()
</script>

{#if isMobile.current}
  <Drawer.Content class={cn('safe-area-bottom h-auto max-h-[85vh] p-0', className)} {...props}>
    {@render children?.()}
  </Drawer.Content>
{:else}
  <Dialog.Content class={className} {...props}>
    {@render children?.()}
  </Dialog.Content>
{/if}

<style>
  :global(.safe-area-bottom) {
    margin-bottom: var(--safe-bottom);
  }
</style>
