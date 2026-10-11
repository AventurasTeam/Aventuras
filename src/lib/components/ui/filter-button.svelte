<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import { Filter } from '@lucide/svelte'
  import type { ComponentProps } from 'svelte'

  type Props = ComponentProps<typeof Button> & { active?: boolean; label: string }

  let { active = false, label, ...rest }: Props = $props()
</script>

<!-- Amber while the list differs from its default. It keeps the mark on hover, which the
     outline button's own hover would otherwise replace. -->
<Button
  variant="outline"
  size="icon"
  class="h-7 w-7 {active ? 'text-amber-500 hover:text-amber-500' : ''}"
  aria-label={label}
  title={label}
  {...rest}
>
  <Filter class="h-3.5 w-3.5" />
</Button>
