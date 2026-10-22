<script lang="ts">
  import * as Dialog from '#lib/components/ui/dialog/index.ts'
  import * as Drawer from '#lib/components/ui/drawer/index.ts'
  import { createIsMobile } from '#lib/hooks/is-mobile.svelte.ts'
  import type { Snippet } from 'svelte'
  import { setResponsiveModalContext } from './context'
  import { blurFocusedElement } from '#lib/utils/scrollLock.ts'
  import type { OnChangeFn } from 'vaul-svelte'

  type Props = {
    open: boolean
    onOpenChange?: OnChangeFn<boolean>
    /** Drawer-only: `false` stops the swipe-down gesture. The desktop dialog has no equivalent. */
    dismissible?: boolean
    /** Drawer-only: opened from inside another modal, so the sheet stacks on that one's. */
    nested?: boolean
    children: Snippet
    [key: string]: unknown
  }

  let {
    open = $bindable(false),
    onOpenChange,
    dismissible = true,
    nested = false,
    children,
    ...props
  }: Props = $props()

  const isMobile = createIsMobile()
  setResponsiveModalContext({ isMobile })

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) blurFocusedElement(isMobile.current)
    onOpenChange?.(newOpen)
  }
</script>

{#if isMobile.current && nested}
  <Drawer.NestedRoot bind:open {dismissible} onOpenChange={handleOpenChange} {...props}>
    {@render children?.()}
  </Drawer.NestedRoot>
{:else if isMobile.current}
  <Drawer.Root bind:open {dismissible} onOpenChange={handleOpenChange} {...props}>
    {@render children?.()}
  </Drawer.Root>
{:else}
  <Dialog.Root bind:open onOpenChange={handleOpenChange} {...props}>
    {@render children?.()}
  </Dialog.Root>
{/if}
