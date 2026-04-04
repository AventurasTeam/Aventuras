<script lang="ts">
  import { settings } from '$lib/stores/settings.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { AlertTriangle, Settings } from 'lucide-svelte'
  import { Button } from '$lib/components/ui/button'

  let hasIssues = $derived(settings.hasGenerationConfigIssues)

  // If profiles are structurally invalid → send to API tab to fix profiles.
  // Otherwise (valid profiles, but missing model) → send to Generation tab.
  let isProfileInvalid = $derived(settings.hasInvalidProfiles())
  let ctaLabel = $derived(isProfileInvalid ? 'Fix API Profiles' : 'Configure Models')
  let message = $derived(
    isProfileInvalid
      ? 'Some API profiles need to be reconfigured before you can use AI features.'
      : 'Some AI services are missing a model. Story generation is blocked until all are configured.',
  )

  function handleFix() {
    if (isProfileInvalid) {
      ui.openSettingsToApiTab()
    } else {
      ui.openSettingsToGenerationTab()
    }
  }
</script>

{#if hasIssues}
  <div
    class="flex items-center justify-between gap-3 bg-amber-500/90 px-4 py-2 text-amber-950 shadow-md"
  >
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <AlertTriangle class="h-5 w-5 shrink-0" />
      <p class="truncate text-sm font-medium">{message}</p>
    </div>
    <Button
      variant="secondary"
      size="sm"
      class="shrink-0 bg-amber-950 text-amber-100 hover:bg-amber-900 hover:text-amber-50"
      onclick={handleFix}
    >
      <Settings class="h-4 w-4" />
      <span class="hidden sm:inline">{ctaLabel}</span>
      <span class="sm:hidden">Fix</span>
    </Button>
  </div>
{/if}
