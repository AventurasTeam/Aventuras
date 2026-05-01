<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    children,
    align,
  }: {
    children?: Snippet
    align?: string
  } = $props()
</script>

<div data-dropdown-content data-align={align}>
  {@render children?.()}
</div>