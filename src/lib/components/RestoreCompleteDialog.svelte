<script lang="ts">
  import * as Dialog from '#lib/components/ui/dialog/index.ts'
  import { Loader2 } from '@lucide/svelte'
  import { ui } from '#lib/stores/ui.svelte.ts'
</script>

<!--
  Not dismissable, and above every sheet and dialog: while the database is being replaced nothing
  else may run, and afterwards it is closed until the app restarts.
-->
<Dialog.Root open={ui.restoreInProgress || ui.restoreComplete}>
  <Dialog.Content
    class="z-(--z-blocking) p-6 sm:max-w-md"
    overlayClass="z-(--z-blocking)"
    interactOutsideBehavior="ignore"
    escapeKeydownBehavior="ignore"
  >
    <Dialog.Header>
      {#if ui.restoreComplete}
        <Dialog.Title>Restore complete</Dialog.Title>
        <Dialog.Description class="pt-2">
          {ui.restoreCloseHint ??
            'Aventuras is closing. Reopen it to continue with the restored database.'}
        </Dialog.Description>
      {:else}
        <Dialog.Title class="flex items-center gap-2">
          <Loader2 class="h-5 w-5 animate-spin" />
          Restoring backup…
        </Dialog.Title>
        <Dialog.Description class="pt-2">
          Replacing your database with the one in the backup. Keep Aventuras open until this
          finishes.
        </Dialog.Description>
      {/if}
    </Dialog.Header>
  </Dialog.Content>
</Dialog.Root>
