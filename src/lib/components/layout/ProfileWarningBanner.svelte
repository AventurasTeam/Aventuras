<script lang="ts">
  import { settings } from '#lib/stores/settings.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { AlertTriangle, Settings } from '@lucide/svelte'
  import { Button } from '#lib/components/ui/button/index.ts'

  let hasIssues = $derived(settings.hasGenerationConfigIssues)
  let healthReason = $derived(settings.modelHealthBlockReason)

  // If profiles are structurally invalid → send to API tab to fix profiles.
  // Otherwise (valid profiles, but missing model) → send to Generation tab.
  let isProfileInvalid = $derived(settings.hasInvalidProfiles())

  let ctaLabel = $derived(
    healthReason
      ? healthReason === 'auth'
        ? 'Fix API Key'
        : 'Change Model'
      : isProfileInvalid
        ? 'Fix API Profiles'
        : 'Configure Models',
  )
  let message = $derived(
    healthReason === 'auth'
      ? 'Authentication failed — use a valid API key or select another model.'
      : healthReason === 'down'
        ? 'Selected model is unreachable — change model or wait for recovery.'
        : isProfileInvalid
          ? 'Some API profiles need to be reconfigured before you can use AI features.'
          : 'Some AI services are missing a model. Story generation is blocked until all are configured.',
  )

  function handleFix() {
    if (healthReason || isProfileInvalid) {
      ui.openSettingsToApiTab()
    } else {
      ui.openSettingsToGenerationTab()
    }
  }
</script>

{#if hasIssues}
  <div
    class="bg-warning/90 text-warning-foreground flex items-center justify-between gap-3 px-4 py-2 shadow-md"
  >
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <AlertTriangle class="h-5 w-5 shrink-0" />
      <p class="truncate text-sm font-medium">{message}</p>
    </div>
    <Button
      variant="secondary"
      size="sm"
      class="bg-warning-foreground text-warning hover:bg-warning-foreground/90 hover:text-warning shrink-0"
      onclick={handleFix}
    >
      <Settings class="h-4 w-4" />
      <span class="hidden sm:inline">{ctaLabel}</span>
      <span class="sm:hidden">Fix</span>
    </Button>
  </div>
{/if}
