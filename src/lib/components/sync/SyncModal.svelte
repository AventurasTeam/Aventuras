<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte'
  import { story } from '$lib/stores/story/index.svelte'
  import { syncService } from '$lib/services/sync'
  import { exportService } from '$lib/services/export'
  import { getVersion } from '@tauri-apps/api/app'
  import {
    QrCode,
    Camera,
    Upload,
    Download,
    Loader2,
    AlertTriangle,
    RefreshCw,
    Check,
  } from 'lucide-svelte'
  import { Html5Qrcode } from 'html5-qrcode'
  import type { SyncServerInfo, SyncStoryPreview, SyncConnectionData } from '$lib/types/sync'
  import { onDestroy } from 'svelte'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { Card, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { Badge } from '$lib/components/ui/badge'

  // State
  let serverInfo = $state<SyncServerInfo | null>(null)
  let connection = $state<SyncConnectionData | null>(null)
  let remoteStories = $state<SyncStoryPreview[]>([])
  let localStories = $state<SyncStoryPreview[]>([])
  let selectedRemoteStory = $state<SyncStoryPreview | null>(null)
  let selectedLocalStory = $state<SyncStoryPreview | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)
  let showConflictWarning = $state(false)
  let conflictStoryTitle = $state<string | null>(null)
  let syncSuccess = $state(false)
  let syncMessage = $state<string | null>(null)

  // State for receiving pushed stories (when in generate mode)
  let receivedStoryJson = $state<string | null>(null)
  let receivedStoryPreview = $state<SyncStoryPreview | null>(null)
  let showReceivedConflict = $state(false)
  let pollingInterval: ReturnType<typeof setInterval> | null = null

  // State for version mismatch warning
  let remoteVersion = $state<string | null>(null)
  let localVersion = $state<string | null>(null)
  let showVersionWarning = $state(false)
  let pendingConnection = $state<SyncConnectionData | null>(null)

  // QR Scanner
  let scanner: Html5Qrcode | null = null
  let scannerElementId = 'qr-reader'

  // Reset state when modal opens
  $effect(() => {
    if (ui.syncModalOpen) {
      resetState()
    }
  })

  function resetState() {
    serverInfo = null
    connection = null
    remoteStories = []
    localStories = []
    selectedRemoteStory = null
    selectedLocalStory = null
    loading = false
    error = null
    showConflictWarning = false
    conflictStoryTitle = null
    syncSuccess = false
    syncMessage = null
    receivedStoryJson = null
    receivedStoryPreview = null
    showReceivedConflict = false
    remoteVersion = null
    localVersion = null
    showVersionWarning = false
    pendingConnection = null
    stopPolling()
  }

  function stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      pollingInterval = null
    }
  }

  function startPolling() {
    stopPolling()
    pollingInterval = setInterval(checkForReceivedStories, 1000)
  }

  async function checkForReceivedStories() {
    try {
      const received = await syncService.getReceivedStories()
      if (received.length > 0) {
        // Take the first received story
        const storyJson = received[0]
        const preview = syncService.getStoryPreview(storyJson)

        if (preview) {
          receivedStoryJson = storyJson
          receivedStoryPreview = preview

          // Check for conflict
          const exists = await syncService.checkStoryExists(preview.title)
          if (exists) {
            showReceivedConflict = true
          } else {
            // No conflict, import directly
            await importReceivedStory()
          }
        }

        // Clear received stories from server
        await syncService.clearReceivedStories()
        stopPolling()
      }
    } catch {
      // Ignore polling errors
    }
  }

  async function importReceivedStory() {
    if (!receivedStoryJson || !receivedStoryPreview) return

    loading = true
    error = null
    showReceivedConflict = false

    try {
      // If replacing, delete the existing story first
      const existingId = await syncService.findStoryIdByTitle(receivedStoryPreview.title)
      if (existingId) {
        await syncService.createPreSyncBackup(existingId)
        await syncService.deleteStory(existingId)
      }

      const result = await exportService.importFromContent(receivedStoryJson, true)

      if (result.success) {
        await story.loadAllStories()
        syncSuccess = true
        syncMessage = `Successfully received "${receivedStoryPreview.title}"`
      } else {
        error = result.error ?? 'Import failed'
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Import failed'
    } finally {
      loading = false
      receivedStoryJson = null
      receivedStoryPreview = null
    }
  }

  function cancelReceivedImport() {
    showReceivedConflict = false
    receivedStoryJson = null
    receivedStoryPreview = null
    // Resume polling for more stories
    startPolling()
  }

  // Cleanup on destroy
  onDestroy(() => {
    cleanup()
  })

  async function cleanup() {
    stopPolling()
    if (scanner) {
      try {
        await scanner.stop()
      } catch {
        // Ignore errors when stopping
      }
      scanner = null
    }
    if (serverInfo) {
      try {
        await syncService.stopServer()
      } catch {
        // Ignore errors when stopping
      }
    }
  }

  async function startGenerateMode() {
    ui.setSyncMode('generate')
    loading = true
    error = null

    try {
      // Export all stories for the server
      const storiesJson = await syncService.exportAllStoriesToJson()
      serverInfo = await syncService.startServer(storiesJson)
      // Start polling for pushed stories
      startPolling()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to start server'
      ui.setSyncMode('select')
    } finally {
      loading = false
    }
  }

  async function startScanMode() {
    ui.setSyncMode('scan')
    error = null

    // Wait for DOM to update
    await new Promise((resolve) => setTimeout(resolve, 100))
    await initScanner()
  }

  async function initScanner() {
    try {
      scanner = new Html5Qrcode(scannerElementId)

      await scanner.start(
        {
          facingMode: 'environment',
        },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        async (decodedText) => {
          await handleQrScanned(decodedText)
        },
        () => {
          // Ignore scan failures during continuous scanning
        },
      )

      // Apply zoom after camera starts (more reliable on mobile)
      try {
        const videoElement = document.querySelector(
          `#${scannerElementId} video`,
        ) as HTMLVideoElement
        if (videoElement && videoElement.srcObject) {
          const track = (videoElement.srcObject as MediaStream).getVideoTracks()[0]
          const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
            zoom?: { min: number; max: number }
          }
          if (capabilities.zoom) {
            const maxZoom = capabilities.zoom.max
            const targetZoom = Math.min(maxZoom, 2.5)
            await track.applyConstraints({
              advanced: [{ zoom: targetZoom } as MediaTrackConstraintSet],
            })
          }
        }
      } catch {
        // Zoom not supported on this device, continue without it
      }
    } catch {
      error = 'Camera access denied or not available'
      ui.setSyncMode('select')
    }
  }

  async function handleQrScanned(data: string) {
    if (scanner) {
      try {
        await scanner.stop()
      } catch {
        // Ignore
      }
      scanner = null
    }

    try {
      const parsed = syncService.parseQrCode(data)
      const appVersion = await getVersion()

      // Check for version mismatch or unknown remote version
      if (!parsed.version || parsed.version !== appVersion) {
        pendingConnection = parsed
        remoteVersion = parsed.version ?? null
        localVersion = appVersion
        showVersionWarning = true
        return
      }

      // No mismatch, proceed normally
      await proceedWithConnection(parsed)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Connection failed'
      ui.setSyncMode('select')
    }
  }

  function cancelVersionMismatch() {
    showVersionWarning = false
    pendingConnection = null
    remoteVersion = null
    localVersion = null
    ui.setSyncMode('select')
  }

  async function proceedWithVersionMismatch() {
    if (!pendingConnection) return
    showVersionWarning = false
    remoteVersion = null
    localVersion = null
    await proceedWithConnection(pendingConnection)
    pendingConnection = null
  }

  async function proceedWithConnection(conn: SyncConnectionData) {
    try {
      connection = conn
      ui.setSyncMode('connected')

      // Fetch available stories from remote
      loading = true
      remoteStories = await syncService.connect(connection)

      // Also load local stories for push option
      const allLocalStories = story.allStories
      localStories = allLocalStories.map((s) => ({
        id: s.id,
        title: s.title,
        genre: s.genre ?? null,
        updatedAt: s.updatedAt,
        entryCount: 0, // We don't track this in the store
      }))
    } catch (e) {
      error = e instanceof Error ? e.message : 'Connection failed'
      ui.setSyncMode('select')
    } finally {
      loading = false
    }
  }

  async function pullStory() {
    if (!connection || !selectedRemoteStory) return

    // Check for conflict
    const exists = await syncService.checkStoryExists(selectedRemoteStory.title)
    if (exists && !showConflictWarning) {
      conflictStoryTitle = selectedRemoteStory.title
      showConflictWarning = true
      return
    }

    ui.setSyncMode('syncing')
    loading = true
    error = null
    showConflictWarning = false

    try {
      // If replacing, delete the existing story first
      const existingId = await syncService.findStoryIdByTitle(selectedRemoteStory.title)
      if (existingId) {
        await syncService.createPreSyncBackup(existingId)
        await syncService.deleteStory(existingId)
      }

      // Pull the story
      const storyJson = await syncService.pullStory(connection, selectedRemoteStory.id)

      // Import using existing import service
      // Use skipImportedSuffix=true so synced stories keep their original title
      const result = await exportService.importFromContent(storyJson, true)

      if (result.success) {
        await story.loadAllStories()
        syncSuccess = true
        syncMessage = `Successfully pulled "${selectedRemoteStory.title}"`
      } else {
        error = result.error ?? 'Import failed'
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Pull failed'
    } finally {
      loading = false
    }
  }

  async function pushStory() {
    if (!connection || !selectedLocalStory) return

    ui.setSyncMode('syncing')
    loading = true
    error = null

    try {
      // Create backup before pushing (on local device)
      await syncService.createPreSyncBackup(selectedLocalStory.id)

      // Export the story
      const storyJson = await syncService.exportStoryToJson(selectedLocalStory.id)

      // Push to remote
      await syncService.pushStory(connection, storyJson)

      syncSuccess = true
      syncMessage = `Successfully pushed "${selectedLocalStory.title}"`
    } catch (e) {
      error = e instanceof Error ? e.message : 'Push failed'
    } finally {
      loading = false
    }
  }

  function cancelConflict() {
    showConflictWarning = false
    conflictStoryTitle = null
  }

  async function close() {
    await cleanup()
    ui.closeSyncModal()
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  function onOpenChange(open: boolean) {
    if (!open) {
      close()
    }
  }
</script>

<ResponsiveModal.Root open={ui.syncModalOpen} {onOpenChange}>
  <ResponsiveModal.Content class="sm:max-w-lg">
    <ResponsiveModal.Header>
      <ResponsiveModal.Title class="flex items-center gap-2">
        <RefreshCw class="text-primary h-5 w-5" />
        {#if ui.syncMode === 'select'}
          Local Network Sync
        {:else if ui.syncMode === 'generate'}
          Waiting for Connection
        {:else if ui.syncMode === 'scan'}
          Scan QR Code
        {:else if ui.syncMode === 'connected'}
          Select Story to Sync
        {:else if ui.syncMode === 'syncing'}
          Syncing...
        {/if}
      </ResponsiveModal.Title>
      <ResponsiveModal.Description>
        {#if ui.syncMode === 'select'}
          Sync stories between devices on the same network.
        {:else if ui.syncMode === 'generate'}
          Show this QR code to another device to connect.
        {:else if ui.syncMode === 'scan'}
          Scan the QR code shown on the other device.
        {:else if ui.syncMode === 'connected'}
          Choose a story to transfer between devices.
        {/if}
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>

    <div class="py-4">
      {#if error}
        <div
          class="bg-destructive/15 text-destructive mb-4 flex items-center gap-2 rounded-lg p-3 text-sm"
        >
          <AlertTriangle class="h-4 w-4 shrink-0" />
          {error}
        </div>
      {/if}

      {#if syncSuccess}
        <!-- Success State -->
        <div class="flex flex-col items-center justify-center py-8 text-center">
          <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
            <Check class="h-8 w-8 text-green-500" />
          </div>
          <h3 class="mb-2 text-lg font-semibold">Sync Complete!</h3>
          <p class="text-muted-foreground">{syncMessage}</p>
          <Button class="mt-6" onclick={close}>Done</Button>
        </div>
      {:else if ui.syncMode === 'select'}
        <!-- Mode Selection -->
        <div class="grid grid-cols-1 gap-4">
          <Card
            class="hover:bg-muted/50 cursor-pointer transition-colors"
            onclick={startGenerateMode}
          >
            <CardHeader class="flex flex-row items-center gap-4 space-y-0 p-4">
              <div class="bg-primary/10 rounded-lg p-3">
                <QrCode class="text-primary h-6 w-6" />
              </div>
              <div>
                <CardTitle class="text-base">Generate QR Code</CardTitle>
                <CardDescription>Show a QR code for another device to scan</CardDescription>
              </div>
            </CardHeader>
          </Card>

          <Card class="hover:bg-muted/50 cursor-pointer transition-colors" onclick={startScanMode}>
            <CardHeader class="flex flex-row items-center gap-4 space-y-0 p-4">
              <div class="bg-primary/10 rounded-lg p-3">
                <Camera class="text-primary h-6 w-6" />
              </div>
              <div>
                <CardTitle class="text-base">Scan QR Code</CardTitle>
                <CardDescription>Scan a QR code from another device</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </div>
      {:else if ui.syncMode === 'generate'}
        <!-- QR Code Display -->
        {#if showReceivedConflict && receivedStoryPreview}
          <!-- Conflict warning for received push -->
          <div class="flex flex-col items-center py-4 text-center">
            <div
              class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20"
            >
              <AlertTriangle class="h-8 w-8 text-amber-500" />
            </div>
            <h3 class="mb-2 text-lg font-semibold">Story Already Exists</h3>
            <p class="text-muted-foreground mb-4">
              A story named "{receivedStoryPreview.title}" already exists on this device. Replacing
              it will create a "Pre-sync backup" checkpoint first. Continue?
            </p>
            <div class="flex gap-3">
              <Button variant="outline" onclick={cancelReceivedImport}>Cancel</Button>
              <Button onclick={importReceivedStory}>Replace</Button>
            </div>
          </div>
        {:else if loading}
          <div class="flex flex-col items-center justify-center py-12">
            <Loader2 class="text-primary h-8 w-8 animate-spin" />
            <p class="text-muted-foreground mt-4">Starting server...</p>
          </div>
        {:else if serverInfo}
          <div class="flex flex-col items-center text-center">
            <div class="mb-4 inline-block rounded-lg bg-white p-4">
              <img
                src="data:image/png;base64,{serverInfo.qrCodeBase64}"
                alt="QR Code"
                class="h-64 w-64"
              />
            </div>
            <p class="text-muted-foreground text-sm">
              Scan this QR code with another device running Aventuras
            </p>
            <p class="text-muted-foreground/60 mt-2 text-xs">
              Server: {serverInfo.ip}:{serverInfo.port}
            </p>
          </div>
        {/if}
      {:else if ui.syncMode === 'scan'}
        <!-- Version Mismatch Warning -->
        {#if showVersionWarning}
          <div class="flex flex-col items-center py-4 text-center">
            <div
              class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20"
            >
              <AlertTriangle class="h-8 w-8 text-amber-500" />
            </div>
            <h3 class="mb-2 text-lg font-semibold">Version Mismatch</h3>
            <p class="text-muted-foreground mb-2">
              The remote device is running a different version of Aventuras.
            </p>
            <div class="text-muted-foreground/80 mb-4 text-sm">
              <p>Local: v{localVersion}</p>
              <p>Remote: {remoteVersion ? `v${remoteVersion}` : 'unknown'}</p>
            </div>
            <p class="text-muted-foreground mb-4 text-sm">
              Syncing between different versions may cause issues. Continue anyway?
            </p>
            <div class="flex gap-3">
              <Button variant="outline" onclick={cancelVersionMismatch}>Cancel</Button>
              <Button onclick={proceedWithVersionMismatch}>Continue Anyway</Button>
            </div>
          </div>
        {:else}
          <!-- QR Scanner -->
          <div class="flex flex-col items-center text-center">
            <div
              id={scannerElementId}
              class="mb-4 overflow-hidden rounded-lg bg-black"
              style="width: 300px; height: 300px;"
            ></div>
            <p class="text-muted-foreground text-sm">Point your camera at the QR code</p>
          </div>
        {/if}
      {:else if ui.syncMode === 'connected'}
        <!-- Story Selection -->
        {#if loading}
          <div class="flex flex-col items-center justify-center py-8">
            <Loader2 class="text-primary h-8 w-8 animate-spin" />
            <p class="text-muted-foreground mt-4">Connecting...</p>
          </div>
        {:else}
          <!-- Conflict Warning -->
          {#if showConflictWarning}
            <div class="mb-4 rounded-lg bg-amber-500/15 p-4 text-amber-600 dark:text-amber-500">
              <div class="mb-2 flex items-center gap-2">
                <AlertTriangle class="h-5 w-5" />
                <span class="font-semibold">Story Already Exists</span>
              </div>
              <p class="text-sm">
                A story named "{conflictStoryTitle}" already exists on this device. Pulling will
                replace it after creating a "Pre-sync backup" checkpoint.
              </p>
              <div class="mt-3 flex gap-2">
                <Button variant="secondary" size="sm" onclick={cancelConflict}>Cancel</Button>
                <Button size="sm" onclick={pullStory}>Continue Anyway</Button>
              </div>
            </div>
          {/if}

          <div class="space-y-6">
            <!-- Pull Stories (from remote) -->
            <div>
              <h3 class="text-muted-foreground mb-2 flex items-center gap-2 text-sm font-medium">
                <Download class="h-4 w-4" />
                Pull from Remote Device
              </h3>
              {#if remoteStories.length > 0}
                <ScrollArea class="h-40 rounded-md border p-1">
                  {#each remoteStories as remoteStory (remoteStory.id)}
                    <button
                      class="hover:bg-accent hover:text-accent-foreground flex w-full flex-col items-start gap-1 rounded-sm px-3 py-2 text-left {selectedRemoteStory?.id ===
                      remoteStory.id
                        ? 'bg-accent text-accent-foreground ring-primary ring-1'
                        : ''}"
                      onclick={() => {
                        selectedRemoteStory = remoteStory
                        selectedLocalStory = null
                      }}
                    >
                      <div class="flex w-full items-center justify-between">
                        <span class="truncate font-medium">{remoteStory.title}</span>
                        {#if remoteStory.genre}
                          <Badge variant="secondary" class="h-5 text-[10px]"
                            >{remoteStory.genre}</Badge
                          >
                        {/if}
                      </div>
                      <div class="text-muted-foreground text-xs">
                        {remoteStory.entryCount} entries • Updated {formatDate(
                          remoteStory.updatedAt,
                        )}
                      </div>
                    </button>
                  {/each}
                </ScrollArea>
              {:else}
                <div class="text-muted-foreground py-4 text-center text-sm">
                  No stories available on remote device
                </div>
              {/if}
            </div>

            <!-- Push Stories (to remote) -->
            <div>
              <h3 class="text-muted-foreground mb-2 flex items-center gap-2 text-sm font-medium">
                <Upload class="h-4 w-4" />
                Push to Remote Device
              </h3>
              {#if localStories.length > 0}
                <ScrollArea class="h-40 rounded-md border p-1">
                  {#each localStories as localStory (localStory.id)}
                    <button
                      class="hover:bg-accent hover:text-accent-foreground flex w-full flex-col items-start gap-1 rounded-sm px-3 py-2 text-left {selectedLocalStory?.id ===
                      localStory.id
                        ? 'bg-accent text-accent-foreground ring-primary ring-1'
                        : ''}"
                      onclick={() => {
                        selectedLocalStory = localStory
                        selectedRemoteStory = null
                      }}
                    >
                      <div class="flex w-full items-center justify-between">
                        <span class="truncate font-medium">{localStory.title}</span>
                        {#if localStory.genre}
                          <Badge variant="secondary" class="h-5 text-[10px]"
                            >{localStory.genre}</Badge
                          >
                        {/if}
                      </div>
                      <div class="text-muted-foreground text-xs">
                        Updated {formatDate(localStory.updatedAt)}
                      </div>
                    </button>
                  {/each}
                </ScrollArea>
              {:else}
                <div class="text-muted-foreground py-4 text-center text-sm">
                  No local stories to push
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {:else if ui.syncMode === 'syncing'}
        <!-- Syncing State -->
        <div class="flex flex-col items-center justify-center py-12">
          <Loader2 class="text-primary h-8 w-8 animate-spin" />
          <p class="text-muted-foreground mt-4">
            {selectedRemoteStory ? 'Pulling' : 'Pushing'} story...
          </p>
          <p class="text-muted-foreground/80 mt-1 text-sm">Please wait</p>
        </div>
      {/if}
    </div>

    <!-- Footer -->
    {#if ui.syncMode === 'connected' && !showConflictWarning && !loading && !syncSuccess}
      <ResponsiveModal.Footer>
        <div class="flex w-full justify-end gap-2">
          <Button variant="outline" onclick={close}>Cancel</Button>
          {#if selectedRemoteStory}
            <Button onclick={pullStory}>
              <Download class="mr-2 h-4 w-4" />
              Pull Story
            </Button>
          {:else if selectedLocalStory}
            <Button onclick={pushStory}>
              <Upload class="mr-2 h-4 w-4" />
              Push Story
            </Button>
          {/if}
        </div>
      </ResponsiveModal.Footer>
    {/if}
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
