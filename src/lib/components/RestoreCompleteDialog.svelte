<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import { ui } from '$lib/stores/ui.svelte'
</script>

<!-- Not dismissable: the database is closed, and the app exits shortly or the user closes it -->
<Dialog.Root open={ui.restoreComplete}>
  <Dialog.Content
    class="p-6 sm:max-w-md"
    interactOutsideBehavior="ignore"
    escapeKeydownBehavior="ignore"
  >
    <Dialog.Header>
      <Dialog.Title>Restore complete</Dialog.Title>
      <Dialog.Description class="pt-2">
        {ui.restoreCloseHint ??
          'Aventuras is closing. Reopen it to continue with the restored database.'}
      </Dialog.Description>
    </Dialog.Header>
  </Dialog.Content>
</Dialog.Root>
