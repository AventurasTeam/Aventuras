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
    /** `false` keeps a dialog at every width instead of a sheet on a phone. */
    sheet?: boolean
    children: Snippet
    [key: string]: unknown
  }

  let {
    open = $bindable(false),
    onOpenChange,
    dismissible = true,
    sheet = true,
    children,
    ...props
  }: Props = $props()

  const isMobile = createIsMobile()
  // The parts read this to pick the drawer's or the dialog's variant.
  setResponsiveModalContext({
    isMobile: {
      get current() {
        return isMobile.current && sheet
      },
    },
  })

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) blurFocusedElement(isMobile.current)
    onOpenChange?.(newOpen)
  }
</script>

{#if isMobile.current && sheet}
  <Drawer.Root bind:open {dismissible} onOpenChange={handleOpenChange} {...props}>
    {@render children?.()}
  </Drawer.Root>
{:else}
  <Dialog.Root bind:open onOpenChange={handleOpenChange} {...props}>
    {@render children?.()}
  </Dialog.Root>
{/if}
