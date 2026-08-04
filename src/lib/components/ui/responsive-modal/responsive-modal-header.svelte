<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import * as Drawer from '$lib/components/ui/drawer'
  import { getResponsiveModalContext } from './context'
  import { cn } from '$lib/utils/cn'
  import { X } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { Snippet } from 'svelte'

  type Props = {
    title?: string
    class?: string
    children?: Snippet
  } & any

  let { title, class: className, children, ...props }: Props = $props()
  const { isMobile } = getResponsiveModalContext()
</script>

{#if isMobile.current}
  <Drawer.Header class={cn('text-center', className)} {...props}>
    {#if title}
      <h2 class="text-lg font-semibold">{title}</h2>
    {:else}
      {@render children?.()}
    {/if}
  </Drawer.Header>
{:else}
  <div
    class={cn(
      'border-border bg-background relative z-10 flex items-center justify-between border-b py-4 sm:rounded-t-lg',
      className,
    )}
  >
    <Dialog.Header class="flex-1" {...props}>
      {#if title}
        <h2 class="text-lg font-semibold">{title}</h2>
      {:else}
        {@render children?.()}
      {/if}
    </Dialog.Header>
    <Dialog.Close>
      <Button variant="destructive" size="icon">
        <X class="size-6!" />
        <span class="sr-only">Close</span>
      </Button>
    </Dialog.Close>
  </div>
{/if}
