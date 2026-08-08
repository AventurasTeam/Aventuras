<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import * as Drawer from '$lib/components/ui/drawer'
  import { createIsMobile } from '$lib/hooks/is-mobile.svelte'
  import type { Snippet } from 'svelte'
  import { setResponsiveModalContext } from './context'
  import { blurFocusedElement } from '$lib/utils/scrollLock'
  import type { OnChangeFn } from 'vaul-svelte'

  type Props = {
    open: boolean
    onOpenChange?: OnChangeFn<boolean>
    children: Snippet
    [key: string]: unknown
  }

  let { open = $bindable(false), onOpenChange, children, ...props }: Props = $props()

  const isMobile = createIsMobile()
  setResponsiveModalContext({ isMobile })

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) blurFocusedElement(isMobile.current)
    onOpenChange?.(newOpen)
  }
</script>

{#if isMobile.current}
  <Drawer.Root bind:open onOpenChange={handleOpenChange} {...props}>
    {@render children?.()}
  </Drawer.Root>
{:else}
  <Dialog.Root bind:open onOpenChange={handleOpenChange} {...props}>
    {@render children?.()}
  </Dialog.Root>
{/if}
