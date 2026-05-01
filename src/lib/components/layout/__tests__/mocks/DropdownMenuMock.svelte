<script lang="ts" module>
  import type { Snippet } from 'svelte'

  // Root: always renders children, exposes open state via bind:open
  export const Root = class {
    open = $state(false)
    children?: Snippet<[]>
  }
</script>

<!-- This file is just a placeholder; individual components are exported from the .ts files below -->