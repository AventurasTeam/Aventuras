<script lang="ts">
  /**
   * The window the user sees when a new version exists.
   *
   * Built on `ResponsiveModal`, so it is a centred dialog on desktop and a bottom sheet on
   * Android without a second implementation.
   *
   * The two platforms end this flow differently and the component says so rather than
   * hiding it: on desktop it downloads, installs and offers a restart; on Android it can
   * only hand the APK to the system browser, because `canInstallInApp` is false there.
   */
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { Progress } from '$lib/components/ui/progress'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { Download, RefreshCw, ExternalLink, AlertTriangle, CheckCircle2 } from '@lucide/svelte'
  import { updaterService, type UpdateProgress } from '$lib/services/updater'
  import { updateNotifier } from '$lib/stores/updateNotifier.svelte'
  import { parseMarkdown } from '$lib/utils/markdown'

  type Phase = 'idle' | 'downloading' | 'installed' | 'handedOff' | 'error'

  let phase = $state<Phase>('idle')
  let progress = $state<UpdateProgress | null>(null)
  let errorMessage = $state<string | null>(null)

  const info = $derived(updateNotifier.info)

  /** Null when the server sent no content length, which is what drives the indeterminate bar. */
  const percent = $derived(
    progress && progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null,
  )

  const changelogHtml = $derived(info?.body ? parseMarkdown(info.body) : '')

  /**
   * Why the app is stepping aside, in the user's terms. A `.deb` user is not on an
   * unsupported platform — their package manager owns the install — and telling them
   * otherwise would send them looking for a problem that is not there.
   */
  const manualInstallNote = $derived(
    info?.manualInstallReason === 'deb-package'
      ? 'This copy was installed from a .deb package, so your package manager owns it. The releases page will open in your browser — download the new .deb and install it the way you installed this one.'
      : 'Aventuras cannot install its own updates on Android. The download will open in your browser.',
  )

  const handedOffNote = $derived(
    info?.manualInstallReason === 'deb-package'
      ? 'The releases page has opened in your browser. Download the new .deb and install it to finish updating.'
      : 'The download has opened in your browser. Once it finishes, open the file to install the update — Android will ask you to confirm.',
  )

  const releasedOn = $derived.by(() => {
    if (!info?.date) return null
    // Tauri's `latest.json` carries an RFC 3339 date; the GitHub API carries an ISO one.
    const parsed = new Date(info.date)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString()
  })

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function handleOpenChange(open: boolean) {
    // A download in flight owns the window: closing it would leave the install running
    // with nothing to report back to.
    if (!open && phase === 'downloading') return
    if (!open) {
      updateNotifier.dismiss()
      phase = 'idle'
      progress = null
      errorMessage = null
    }
  }

  async function handleInstall() {
    phase = 'downloading'
    errorMessage = null
    progress = { downloaded: 0, total: null }

    try {
      const ok = await updaterService.downloadAndInstall((p) => {
        progress = p
      })
      phase = ok ? 'installed' : 'error'
      if (!ok) {
        errorMessage = 'The update was no longer available to install. Try checking again.'
      }
    } catch (error) {
      phase = 'error'
      errorMessage = error instanceof Error ? error.message : 'The update could not be downloaded.'
    }
  }

  async function handleOpenInBrowser() {
    try {
      await updaterService.openDownloadPage()
      phase = 'handedOff'
    } catch (error) {
      phase = 'error'
      errorMessage = error instanceof Error ? error.message : 'Could not open the download page.'
    }
  }

  function handleRelaunch() {
    void updaterService.relaunch()
  }
</script>

{#if info}
  <ResponsiveModal.Root open={updateNotifier.open} onOpenChange={handleOpenChange}>
    <ResponsiveModal.Content class="p-0 sm:max-w-lg">
      <ResponsiveModal.Header class="border-b px-6 py-4">
        <ResponsiveModal.Title class="flex items-center gap-2">
          <Download class="h-5 w-5 shrink-0" />
          Update available
        </ResponsiveModal.Title>
        <ResponsiveModal.Description>
          Aventuras {info.version} is available{info.currentVersion
            ? ` — you have ${info.currentVersion}`
            : ''}{releasedOn ? `, released ${releasedOn}` : ''}.
        </ResponsiveModal.Description>
      </ResponsiveModal.Header>

      <div class="flex flex-col gap-4 px-6 py-4">
        {#if changelogHtml}
          <div class="flex flex-col gap-2">
            <span class="text-sm font-medium">What's new</span>
            <ScrollArea class="max-h-56 rounded-md border p-3">
              <!-- Release notes come from the project's own signed release metadata. -->
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <div class="release-notes text-muted-foreground text-sm">
                {@html changelogHtml}
              </div>
            </ScrollArea>
          </div>
        {/if}

        {#if phase === 'downloading'}
          <div class="flex flex-col gap-2">
            <Progress value={percent ?? 0} class="h-2" />
            <span class="text-muted-foreground text-xs">
              {#if percent !== null && progress?.total}
                Downloading… {percent}% ({formatBytes(progress.downloaded)} of {formatBytes(
                  progress.total,
                )})
              {:else if progress}
                Downloading… {formatBytes(progress.downloaded)}
              {:else}
                Starting download…
              {/if}
            </span>
          </div>
        {:else if phase === 'installed'}
          <div class="text-muted-foreground flex items-start gap-2 rounded-md border p-3 text-sm">
            <CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
            <span>The update is installed. Restart Aventuras to start using it.</span>
          </div>
        {:else if phase === 'handedOff'}
          <div class="text-muted-foreground flex items-start gap-2 rounded-md border p-3 text-sm">
            <ExternalLink class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{handedOffNote}</span>
          </div>
        {:else if phase === 'error' && errorMessage}
          <div class="text-destructive flex items-start gap-2 rounded-md border p-3 text-sm">
            <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        {:else if !info.canInstallInApp}
          <p class="text-muted-foreground text-sm">{manualInstallNote}</p>
        {/if}
      </div>

      <ResponsiveModal.Footer class="border-t px-6 py-4">
        {#if phase === 'installed'}
          <Button variant="outline" onclick={() => handleOpenChange(false)}>Later</Button>
          <Button onclick={handleRelaunch}>
            <RefreshCw class="mr-2 h-4 w-4" />
            Restart now
          </Button>
        {:else if phase === 'handedOff'}
          <Button onclick={() => handleOpenChange(false)}>Done</Button>
        {:else if phase === 'downloading'}
          <Button disabled>Downloading…</Button>
        {:else if info.canInstallInApp}
          <Button variant="outline" onclick={() => handleOpenChange(false)}>Not now</Button>
          <Button onclick={handleInstall}>
            <Download class="mr-2 h-4 w-4" />
            {phase === 'error' ? 'Try again' : 'Download and install'}
          </Button>
        {:else}
          <Button variant="outline" onclick={() => handleOpenChange(false)}>Not now</Button>
          <Button onclick={handleOpenInBrowser}>
            <ExternalLink class="mr-2 h-4 w-4" />
            {info.manualInstallReason === 'deb-package' ? 'Open releases page' : 'Download update'}
          </Button>
        {/if}
      </ResponsiveModal.Footer>
    </ResponsiveModal.Content>
  </ResponsiveModal.Root>
{/if}

<style>
  /* Release notes are authored Markdown; give the rendered HTML enough shape to read. */
  .release-notes :global(h1),
  .release-notes :global(h2),
  .release-notes :global(h3) {
    color: var(--foreground);
    font-weight: 600;
    margin-block: 0.5rem 0.25rem;
  }

  .release-notes :global(ul) {
    list-style: disc;
    padding-inline-start: 1.25rem;
  }

  .release-notes :global(p) {
    margin-block: 0.25rem;
  }

  .release-notes :global(a) {
    text-decoration: underline;
  }

  .release-notes :global(code) {
    font-family: var(--font-mono, monospace);
    font-size: 0.85em;
  }
</style>
