<script lang="ts">
  import { onMount } from 'svelte'
  import { database } from '$lib/services/database'
  import { settings } from '$lib/stores/settings.svelte'
  import { grammarService } from '$lib/services/grammar'
  import { updaterService } from '$lib/services/updater'
  import { updateNotifier } from '$lib/stores/updateNotifier.svelte'
  import { packService } from '$lib/services/packs/pack-service'
  import { warmupAllProfiles } from '$lib/services/modelHealthOrchestrator'
  import AppShell from '$lib/components/layout/AppShell.svelte'
  import WelcomeScreen from '$lib/components/intro/WelcomeScreen.svelte'

  let initialized = $state(false)
  let error = $state<string | null>(null)
  let showProviderSetup = $state(false)

  onMount(async () => {
    try {
      // Initialize database connection
      await database.init()

      // Seed prompt templates into the database (idempotent)
      await packService.initialize()

      // Initialize settings from database
      await settings.init()

      // Warm up model health cache now that settings (profiles, models) are loaded
      warmupAllProfiles().catch((err) => console.warn('[health] warmup failed', err))

      // Check if this is a first-run (new user)
      if (!settings.firstRunComplete) {
        showProviderSetup = true
        // Don't fully initialize until provider is selected
        return
      }

      // Pre-load grammar checker WASM in background (don't await)
      grammarService.setup().catch(console.error)

      // Check for updates on startup if enabled (don't await, run in background)
      if (settings.updateSettings.autoCheck) {
        const { checkInterval, lastChecked } = settings.updateSettings
        const now = Date.now()
        const shouldCheck =
          checkInterval <= 0
            ? true
            : !lastChecked || now - lastChecked >= checkInterval * 60 * 60 * 1000

        if (shouldCheck) {
          updaterService
            .checkForUpdates()
            .then(async (updateInfo) => {
              await settings.setLastChecked(Date.now())
              // Offer the update in a dialog rather than logging it: a console message
              // reaches nobody outside a dev build.
              updateNotifier.show(updateInfo)
            })
            // A failed startup check stays silent. The user did not ask for it, so an
            // error toast about it would interrupt them over something they cannot act on;
            // the manual button in Settings reports failures properly.
            .catch((err) => console.error('[Updater] Startup check failed:', err))
        }
      }

      initialized = true
    } catch (e) {
      console.error('Initialization error:', e)
      error = e instanceof Error ? e.message : 'Failed to initialize application'
    }
  })

  async function handleProviderSetupComplete() {
    showProviderSetup = false
    // Ensure templates are seeded (idempotent, safe to call again)
    await packService.initialize()
    // Continue with initialization
    grammarService.setup().catch(console.error)
    initialized = true
  }
</script>

{#if error}
  <div class="bg-surface-900 flex h-screen w-screen items-center justify-center">
    <div class="card max-w-md text-center">
      <h1 class="text-xl font-semibold text-red-400">Initialization Error</h1>
      <p class="text-surface-400 mt-2">{error}</p>
      <button class="btn btn-primary mt-4" onclick={() => window.location.reload()}> Retry </button>
    </div>
  </div>
{:else if showProviderSetup}
  <WelcomeScreen onComplete={handleProviderSetupComplete} />
{:else if !initialized}
  <div class="bg-surface-900 flex h-screen w-screen items-center justify-center">
    <div class="flex flex-col items-center gap-4">
      <div
        class="border-accent-500 h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
      ></div>
      <p class="text-surface-400">Loading Aventuras...</p>
    </div>
  </div>
{:else}
  <AppShell>
    <!-- Default slot content if needed -->
  </AppShell>
{/if}
