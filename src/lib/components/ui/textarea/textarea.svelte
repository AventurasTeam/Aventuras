<script lang="ts">
  import type { WithElementRef, WithoutChildren } from 'bits-ui'
  import type { HTMLTextareaAttributes } from 'svelte/elements'
  import { cn } from '$lib/utils/cn.js'
  import { autosize } from '$lib/utils/autosize'

  type Props = WithoutChildren<WithElementRef<HTMLTextareaAttributes>> & {
    /** Grow with the content up to `max-h`, instead of keeping the height a caller set. */
    autosize?: boolean
  }

  let {
    ref = $bindable(null),
    value = $bindable(),
    autosize: autosizeEnabled = true,
    class: className,
    ...restProps
  }: Props = $props()
</script>

<textarea
  bind:this={ref}
  class={cn(
    'border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring flex min-h-[80px] w-full rounded-md border px-3 py-2 text-base focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
    autosizeEnabled && 'max-h-[50dvh] resize-none',
    className,
  )}
  bind:value
  use:autosize={{ enabled: autosizeEnabled, value }}
  {...restProps}></textarea>
