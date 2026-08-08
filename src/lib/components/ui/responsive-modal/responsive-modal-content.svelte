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
  <!--
    Capped to the visible area, not the viewport: Android runs edge-to-edge, so `100vh`
    spans the space behind the system bars and a centred `h-[90vh]` dialog can sit under
    the navigation bar. `dvh` so the cap follows the soft keyboard too.

    Inert on desktop, where every inset is 0, and a caller's own `max-h-*` still wins since
    `className` is merged last. Height only — the matching `max-w` would be deleted by
    every caller that sets its own, so it would only protect the modals that need it least.
  -->
  <Dialog.Content
    class={cn('max-h-[calc(100dvh_-_var(--safe-top)_-_var(--safe-bottom)_-_2rem)]', className)}
    {...props}
  >
    {@render children?.()}
  </Dialog.Content>
{/if}

<style>
  :global(.safe-area-bottom) {
    margin-bottom: var(--safe-bottom);
  }
</style>
