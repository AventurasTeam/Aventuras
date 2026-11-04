<!--
  A confirmation that is its question alone: a title, a sentence or two, Cancel and the action.
  No body, so one that needs fields or a list becomes an ActionModal. See
  docs/development/ui-components.md.
-->
<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import ActionModal from './ActionModal.svelte'

  type Props = Pick<
    ComponentProps<typeof ActionModal>,
    'onCancel' | 'onClosed' | 'title' | 'titleIcon' | 'action' | 'busy' | 'cancelLabel'
  > & {
    open?: boolean
    description?: string
  }

  let { open = $bindable(false), ...rest }: Props = $props()
</script>

<ActionModal bind:open compact {...rest} />
