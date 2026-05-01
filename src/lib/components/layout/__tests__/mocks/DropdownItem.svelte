<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    onclick,
    children,
  }: {
    onclick?: (e: MouseEvent) => void
    children?: Snippet
  } = $props()
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div role="menuitem" tabindex="0" {onclick}>
  {@render children?.()}
</div>