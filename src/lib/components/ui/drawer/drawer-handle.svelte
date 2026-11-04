<script lang="ts">
  import { Drawer as DrawerPrimitive } from 'vaul-svelte'
  import { cn } from '#lib/utils/cn.ts'

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: DrawerPrimitive.HandleProps = $props()
</script>

<DrawerPrimitive.Handle
  bind:ref
  class={cn('bg-muted mx-auto mt-4 h-2 w-[100px] rounded-full', className)}
  {...restProps}
/>
