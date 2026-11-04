<script lang="ts">
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { story } from '#lib/stores/story.svelte.ts'
  import { settings } from '#lib/stores/settings.svelte.ts'
  import { characterVault } from '#lib/stores/characterVault.svelte.ts'
  import { lorebookVault } from '#lib/stores/lorebookVault.svelte.ts'
  import { scenarioVault } from '#lib/stores/scenarioVault.svelte.ts'
  import {
    answerSyncRequest,
    applyItem,
    applyStory,
    decodeEnvelope,
    encodeConnectionCode,
    findReceiveTarget,
    loadSelf,
    renameSelf,
    storiesUsingPack,
    storySyncRecord,
    syncService,
    type ReceiveTarget,
  } from '#lib/services/sync/index.ts'
  import { getVersion } from '@tauri-apps/api/app'
  import { listen, type UnlistenFn } from '@tauri-apps/api/event'
  import { QrCode, Camera, Loader2, AlertTriangle, Check } from '@lucide/svelte'
  import { Html5Qrcode } from 'html5-qrcode'
  import { SYNC_PROTOCOL_VERSION } from '#lib/types/sync.ts'
  import type {
    SyncConnectionData,
    SyncEnvelope,
    SyncPeer,
    SyncPushOutcome,
    SyncReceivedItem,
    SyncSection,
    SyncServerInfo,
    SyncWebviewRequest,
  } from '#lib/types/sync.ts'
  import SyncBrowser from './SyncBrowser.svelte'
  import SyncCodeDisplay from './SyncCodeDisplay.svelte'
  import SyncCodeEntry from './SyncCodeEntry.svelte'
  import SyncDeviceName from './SyncDeviceName.svelte'
  import { onDestroy, untrack } from 'svelte'
  import PackMappingDialog from '#lib/components/story/PackMappingDialog.svelte'
  import type { PresetPack } from '#lib/services/packs/index.ts'
  import { planPackBinding, previewImport } from '#lib/services/import/index.ts'
  import type { PackBindingContext, PackBindingResolution } from '#lib/services/import/index.ts'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { cn } from '#lib/utils/cn.ts'
  import { PAIR_BUTTON, PAIR_ROW } from '#lib/components/shared/buttonPair.ts'
  import ModalHeader from '#lib/components/shared/ModalHeader.svelte'
  import { Card, CardHeader, CardTitle, CardDescription } from '#lib/components/ui/card/index.ts'

  /** Non-null only while a transfer is waiting on the user's pack choice. */
  let packMapping = $state<{
    context: PackBindingContext
    lockedPack?: PresetPack | null
    onlyVariables?: string[]
    resolve: (resolution: PackBindingResolution | null) => void
  } | null>(null)

  /**
   * Settle which pack the incoming story binds to, before the transfer writes or deletes anything.
   *
   * This runs ahead of `deleteStory` on purpose. Both receive paths remove the story they are
   * replacing *before* importing, so a question asked any later would let a cancel destroy the
   * copy being replaced and put nothing in its place.
   *
   * Sync can ask at all because it is user-driven: the payload is already downloaded and no
   * remote party is waiting. A background sync would need a different answer here.
   *
   * Returns the resolution, or `null` if the user backed out — in which case the caller must
   * return without touching anything.
   */
  async function resolveIncomingPack(
    storyJson: string,
  ): Promise<PackBindingResolution | null | { error: string }> {
    const preview = await previewImport(storyJson)
    if ('error' in preview) return preview
    const { context } = preview

    const plan = await planPackBinding(context)
    if (!plan.ask) return plan.resolution

    return new Promise((resolve) => {
      packMapping = {
        context,
        lockedPack: plan.lockedPack,
        onlyVariables: plan.onlyVariables,
        resolve: (value) => {
          packMapping = null
          resolve(value)
        },
      }
    })
  }

  // State
  let serverInfo = $state<SyncServerInfo | null>(null)
  let connectionCode = $state<string | null>(null)
  /** Which of the two pairing screens this side is on. */
  let pairingView = $state<'visual' | 'code'>('visual')
  let cameraNote = $state<string | null>(null)
  let connection = $state<SyncConnectionData | null>(null)
  let self = $state<SyncPeer | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)
  /** The device using this server. Requests are stateless, so it stays until the server stops. */
  let connectedPeer = $state<SyncPeer | null>(null)
  let syncMessage = $state<string | null>(null)

  // State for receiving pushed items (when in generate mode)
  let received = $state<{ envelope: SyncEnvelope; peer: SyncPeer; requestId: string } | null>(null)
  /** Null until worked out, so a failed lookup cannot leave the previous item's target behind. */
  let receivedTarget = $state<ReceiveTarget | null>(null)
  /** Read once: a replacing import that fails has already deleted the story. */
  let receivedPrevious: Awaited<ReturnType<typeof storySyncRecord>> = null
  /** Stories on this device bound to the pack being replaced. */
  let receivedPackUsers = $state(0)
  let receivedQueue = $state<SyncReceivedItem[]>([])
  let showReceivedConflict = $state(false)
  let pollingInterval: ReturnType<typeof setInterval> | null = null
  let unlistenRequests: UnlistenFn | null = null
  let receivingStory = $state(false)
  let receivedStoryNeedsPack = $state(false)
  /**
   * Bumped whenever the pending received item changes hands: a new claim, a discard, or a modal
   * reset. An import that started under an older token must not write to the session that replaced
   * it, and comparing payloads is not enough — the same story can be pushed twice, byte for byte.
   */
  let receivedSession = 0

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
      // resetState reads packMapping to cancel stale work. Do not make that read a dependency or
      // opening a new pack dialog would retrigger this effect and immediately cancel itself.
      untrack(resetState)
    }
  })

  function resetState() {
    // Settle an older transfer before discarding the state it was waiting on. Merely removing the
    // dialog would leave resolveIncomingPack suspended forever.
    cancelPendingPackMapping()
    serverInfo = null
    connectionCode = null
    pairingView = 'visual'
    cameraNote = null
    connection = null
    loading = false
    error = null
    connectedPeer = null
    syncMessage = null
    received = null
    receivedTarget = null
    receivedPrevious = null
    receivedPackUsers = 0
    receivedQueue = []
    showReceivedConflict = false
    receivingStory = false
    receivedStoryNeedsPack = false
    receivedSession++
    remoteVersion = null
    localVersion = null
    showVersionWarning = false
    pendingConnection = null
    stopPolling()
    void loadDevice()
  }

  async function loadDevice() {
    try {
      self = await loadSelf()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  function cancelPendingPackMapping() {
    packMapping?.resolve(null)
  }

  function stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      pollingInterval = null
    }
  }

  function startPolling() {
    stopPolling()
    pollingInterval = setInterval(checkForReceivedItems, 1000)
  }

  async function checkForReceivedItems() {
    try {
      const items = await syncService.getReceivedItems()
      if (items.length > 0) {
        if (received || receivingStory) return
        // The native API clears its whole queue at once. Keep every payload after the claimed
        // one locally, then process them in order after the active transfer finishes.
        const [item, ...queued] = items
        receivedQueue = queued
        stopPolling()
        await syncService.clearReceivedItems()
        await claimReceivedItem(item)
      }
    } catch {
      // Ignore polling errors
    }
  }

  async function claimReceivedItem(item: SyncReceivedItem) {
    let envelope: SyncEnvelope
    try {
      envelope = decodeEnvelope(item.payload)
    } catch {
      error = 'Received an invalid payload'
      answerPush(item.requestId, { error: 'The other device could not read the item' })
      resumeReceivedItems()
      return
    }

    received = { envelope, peer: item.peer, requestId: item.requestId }
    connectedPeer = item.peer
    receivedTarget = null
    receivedPrevious = null
    receivedStoryNeedsPack = false
    receivedSession++
    await prepareReceived(envelope)
  }

  /** Works out what the item replaces, then applies it or asks. */
  async function prepareReceived(envelope: SyncEnvelope) {
    const session = receivedSession
    receivingStory = true
    error = null

    try {
      const target = await findReceiveTarget(envelope)
      const packUsers =
        target.kind !== 'new' && envelope.section === 'packs'
          ? await storiesUsingPack(target.localId)
          : 0
      if (session !== receivedSession) return

      receivedTarget = target
      receivedPackUsers = packUsers
      receivingStory = false
      if (target.kind === 'new') await importReceived(null)
      else showReceivedConflict = true
    } catch (e) {
      if (session !== receivedSession) return
      error = e instanceof Error ? e.message : 'Could not prepare the received item'
      receivingStory = false
    }
  }

  /** A sender that stopped waiting has nothing to hear, so a failed answer changes nothing. */
  function answerPush(requestId: string, answer: { data: SyncPushOutcome } | { error: string }) {
    syncService.respond(requestId, answer).catch(() => {})
  }

  function resumeReceivedItems() {
    const [next, ...remaining] = receivedQueue
    if (next) {
      receivedQueue = remaining
      void claimReceivedItem(next)
    } else {
      startPolling()
    }
  }

  async function reloadSection(section: SyncSection) {
    switch (section) {
      case 'stories':
        return story.loadAllStories()
      case 'characters':
        return characterVault.load()
      case 'lorebooks':
        return lorebookVault.load()
      case 'scenarios':
        return scenarioVault.load()
    }
  }

  /** Applies the pending item, over `existingId` when the user agreed to replace it. */
  async function importReceived(existingId: string | null) {
    if (!received || receivingStory) return
    const pending = received
    const pendingSession = receivedSession
    const isStory = pending.envelope.section === 'stories'
    receivingStory = true
    receivedStoryNeedsPack = false
    error = null

    // Pack first — and deliberately outside the block below, whose `finally` discards the
    // received payload. The poller has already cleared the server's copy, so a cancel that fell
    // through to it would lose the story outright; backing out must leave it pending so the user
    // can go install the pack and click again.
    let packBinding: PackBindingResolution | null | { error: string } = null
    if (isStory) {
      try {
        packBinding = await resolveIncomingPack(pending.envelope.document)
      } catch (e) {
        error = e instanceof Error ? e.message : 'Could not prepare the received story'
        receivingStory = false
        return
      }
      if (packBinding && 'error' in packBinding) {
        error = packBinding.error
        receivingStory = false
        return
      }
      if (!packBinding) {
        // A lifecycle reset settles the dialog after it has already dropped the pending payload.
        // Only mark a user-cancelled choice as retryable when this session is still the live one.
        if (receivedSession === pendingSession) receivedStoryNeedsPack = true
        receivingStory = false
        return
      }
    }

    // Everything below writes to the database, so a resolution that arrives after the modal was
    // reset — or after a newer payload took over — must stop before it replaces a story the user
    // is no longer talking about.
    if (receivedSession !== pendingSession) return

    loading = true
    error = null
    showReceivedConflict = false

    let importError: string | null = null
    let imported = false
    let renamedTo: string | undefined
    try {
      if (isStory) {
        if (existingId && !receivedPrevious) {
          receivedPrevious = await storySyncRecord(existingId)
        }
        const result = await applyStory(
          pending.envelope,
          pending.peer,
          existingId,
          packBinding as PackBindingResolution,
          receivedPrevious,
        )
        imported = result.success
        if (!result.success) importError = result.error ?? 'Import failed'
      } else {
        renamedTo = (await applyItem(pending.envelope, pending.peer, existingId)).renamedTo
        imported = true
      }
      // Inside the block on purpose: a reload that fails must still fall through to the teardown
      // below, or the modal is left loading with the queue paused. The item is already applied
      // either way, so this cannot turn a success into a reported failure.
      if (imported) {
        try {
          await reloadSection(pending.envelope.section)
        } catch {
          // The list refreshes on the next load.
        }
      }
    } catch (e) {
      importError = e instanceof Error ? e.message : 'Import failed'
    }

    // Report into, and tear down, only the session this import belongs to. A reset or a newer
    // transfer can take over while the import runs; writing that session's error, clearing its
    // payload, or resuming a queue it already dropped would clobber it.
    if (receivedSession !== pendingSession) return

    loading = false
    receivingStory = false

    if (importError) {
      // Keep the payload pending rather than dropping it. The poller already cleared the server's
      // copy, so this is the only remaining chance to retry, and a replacement import that failed
      // after deleting the local story makes that retry the user's only way back.
      error = importError
      return
    }

    received = null
    answerPush(pending.requestId, { data: 'applied' })
    syncMessage = renamedTo
      ? `Received "${pending.envelope.name}" as "${renamedTo}": that name was taken.`
      : `Successfully received "${pending.envelope.name}"`
    resumeReceivedItems()
  }

  function retryReceived() {
    if (!received) return
    const target = receivedTarget
    if (!target) return prepareReceived(received.envelope)
    return importReceived(target.kind === 'new' ? null : target.localId)
  }

  function discardReceived() {
    showReceivedConflict = false
    receivingStory = false
    receivedStoryNeedsPack = false
    receivedSession++
    if (received) answerPush(received.requestId, { data: 'declined' })
    received = null
    resumeReceivedItems()
  }

  // Cleanup on destroy
  onDestroy(() => {
    cancelPendingPackMapping()
    cleanup()
  })

  async function stopScanner() {
    const running = scanner
    scanner = null
    try {
      await running?.stop()
    } catch {
      // Ignore errors when stopping
    }
  }

  async function cleanup() {
    stopPolling()
    stopServing()
    await stopScanner()
    if (serverInfo) {
      try {
        await syncService.stopServer()
      } catch {
        // Ignore errors when stopping
      }
    }
  }

  function trackingForExport() {
    return {
      on: settings.experimentalFeatures.stateTracking,
      enabledSince: settings.experimentalFeatures.trackingEnabledSince,
    }
  }

  function stopServing() {
    unlistenRequests?.()
    unlistenRequests = null
  }

  async function serveRequest(request: SyncWebviewRequest) {
    connectedPeer = request.peer
    try {
      const data = await answerSyncRequest(request, trackingForExport())
      await syncService.respond(request.requestId, { data })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The request failed'
      await syncService.respond(request.requestId, { error: message })
    }
  }

  async function startGenerateMode() {
    ui.setSyncMode('generate')
    pairingView = 'visual'
    loading = true
    error = null

    try {
      stopServing()
      unlistenRequests = await listen<SyncWebviewRequest>('sync://request', ({ payload }) => {
        void serveRequest(payload)
      })
      const info = await syncService.startServer()
      serverInfo = info
      connectionCode = encodeConnectionCode({
        ip: info.ip,
        port: info.port,
        token: info.token,
        version: await getVersion(),
        protocol: SYNC_PROTOCOL_VERSION,
      })
      // Start polling for pushed items
      startPolling()
    } catch (e) {
      stopServing()
      error = e instanceof Error ? e.message : 'Failed to start server'
      ui.setSyncMode('select')
    } finally {
      loading = false
    }
  }

  // The server keeps running, so the code on screen still pairs. A peer still connected returns
  // here with its next request.
  function showPairing() {
    connectedPeer = null
    syncMessage = null
  }

  const TRIO_ROW = 'flex w-full flex-col gap-2 sm:grid sm:w-fit sm:auto-cols-fr sm:grid-flow-col'
  const TRIO_BUTTON = 'sm:min-w-34'
  const three = $derived(receivedTarget?.kind === 'sameName')

  const title = $derived.by(() => {
    switch (ui.syncMode) {
      case 'select':
        return 'Local network sync'
      case 'generate':
        if (receivingStory) return loading ? 'Importing' : 'Preparing import'
        if (received) return 'Item received'
        return connectedPeer ? 'Connected' : 'Waiting for connection'
      case 'scan':
        return pairingView === 'code' ? 'Enter a connection code' : 'Scan a QR code'
      case 'connected':
        return 'Sync'
    }
  })

  function renameDevice(name: string) {
    if (self) self = { ...self, name }
    void renameSelf(name)
  }

  async function startScanMode() {
    ui.setSyncMode('scan')
    pairingView = 'visual'
    cameraNote = null
    error = null

    // Wait for DOM to update
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (ui.syncMode === 'scan' && pairingView === 'visual') await initScanner()
  }

  async function initScanner() {
    try {
      const instance = new Html5Qrcode(scannerElementId)
      scanner = instance

      await instance.start(
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

      // The user can leave this screen while the camera is starting.
      if (scanner !== instance) {
        await instance.stop()
        return
      }

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
      await stopScanner()
      if (ui.syncMode !== 'scan' || pairingView !== 'visual') return
      pairingView = 'code'
      cameraNote = 'No camera available. Paste the code from the other device.'
    }
  }

  async function enterCodeInstead() {
    await stopScanner()
    pairingView = 'code'
  }

  async function handleQrScanned(data: string) {
    await stopScanner()

    try {
      await pair(syncService.parseQrCode(data))
    } catch (e) {
      error = e instanceof Error ? e.message : 'Connection failed'
      ui.setSyncMode('select')
    }
  }

  async function pair(parsed: SyncConnectionData) {
    if (parsed.protocol !== SYNC_PROTOCOL_VERSION) {
      error = 'The other device is on a different sync version. Update both devices.'
      if (pairingView === 'visual') ui.setSyncMode('select')
      return
    }
    error = null

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
  }

  function cancelVersionMismatch() {
    showVersionWarning = false
    pendingConnection = null
    remoteVersion = null
    localVersion = null
    if (pairingView === 'visual') ui.setSyncMode('select')
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
    connection = conn
    ui.setSyncMode('connected')
  }

  function disconnected(message: string) {
    error = message
    connection = null
    ui.setSyncMode('select')
  }

  async function close() {
    // Mark the modal closed before settling the promise so the suspended pull cannot switch the
    // hidden modal back to its connected state while cleanup is running.
    ui.closeSyncModal()
    cancelPendingPackMapping()
    await cleanup()
  }

  function onOpenChange(open: boolean) {
    if (!open) {
      close()
    }
  }
</script>

<ResponsiveModal.Root open={ui.syncModalOpen} {onOpenChange}>
  <ResponsiveModal.Content handle={false} class="flex max-h-[85dvh] flex-col gap-0 p-0 sm:max-w-lg">
    <ModalHeader {title} closeButton />

    <div class="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-4">
      <ResponsiveModal.Description class="mb-4">
        {#if ui.syncMode === 'select'}
          Sync stories, vault items and prompt packs between devices on the same network.
        {:else if ui.syncMode === 'generate'}
          {receivingStory
            ? loading
              ? 'Importing the received item.'
              : 'Preparing the received item for import.'
            : received
              ? 'Review the item received from the connected device.'
              : connectedPeer
                ? 'Keep this screen open while syncing.'
                : pairingView === 'code'
                  ? 'Enter this code on the other device.'
                  : 'Show this QR code to another device to connect.'}
        {:else if ui.syncMode === 'scan'}
          {pairingView === 'code'
            ? 'Paste the code shown on the other device.'
            : 'Scan the QR code shown on the other device.'}
        {:else if ui.syncMode === 'connected'}
          Choose what to transfer between devices.
        {/if}
      </ResponsiveModal.Description>

      {#if error}
        <div
          class="bg-destructive/15 text-destructive mb-4 flex items-center gap-2 rounded-lg p-3 text-sm"
        >
          <AlertTriangle class="h-4 w-4 shrink-0" />
          {error}
        </div>
      {/if}

      {#if ui.syncMode === 'select'}
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
                <CardTitle class="text-base">Show connection code</CardTitle>
                <CardDescription>Another device connects to this one</CardDescription>
              </div>
            </CardHeader>
          </Card>

          <Card class="hover:bg-muted/50 cursor-pointer transition-colors" onclick={startScanMode}>
            <CardHeader class="flex flex-row items-center gap-4 space-y-0 p-4">
              <div class="bg-primary/10 rounded-lg p-3">
                <Camera class="text-primary h-6 w-6" />
              </div>
              <div>
                <CardTitle class="text-base">Connect to a device</CardTitle>
                <CardDescription>Scan or enter its code</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </div>
      {:else if ui.syncMode === 'generate'}
        <!-- QR Code Display -->
        {#if receivingStory || loading}
          <div class="flex flex-col items-center justify-center py-12">
            <Loader2 class="text-primary h-8 w-8 animate-spin" />
            <p class="text-muted-foreground mt-4">
              {receivingStory
                ? loading
                  ? 'Importing...'
                  : 'Preparing import...'
                : 'Starting server...'}
            </p>
          </div>
        {:else if showReceivedConflict && received}
          <!-- Conflict warning for received push -->
          <div class="flex flex-col items-center py-4 text-center">
            <div
              class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20"
            >
              <AlertTriangle class="h-8 w-8 text-amber-500" />
            </div>
            <h3 class="mb-2 text-lg font-semibold">Already on this device</h3>
            <p class="text-muted-foreground mb-4 break-words">
              {#if receivedTarget?.kind === 'sameName'}
                An item named "{received.envelope.name}" is already on this device, and the two have
                never synced. Replace it with the received one, or add the received one separately?
              {:else}
                Replace this device's copy with the received "{received.envelope.name}"?
              {/if}
            </p>
            {#if receivedPackUsers > 0}
              <p class="text-muted-foreground mb-4 text-sm">
                {receivedPackUsers}
                {receivedPackUsers === 1 ? 'story uses' : 'stories use'} this pack and will narrate through
                the received version.
              </p>
            {/if}
            {#if receivedStoryNeedsPack}
              <p class="text-muted-foreground mb-4 text-sm">
                A prompt pack must still be selected before the received story can be imported.
              </p>
            {/if}
            <!-- Three choices stack on a phone; the pair layout fits only two. -->
            <div class={three ? TRIO_ROW : PAIR_ROW}>
              <Button
                variant="outline"
                class={three ? TRIO_BUTTON : PAIR_BUTTON}
                onclick={discardReceived}
              >
                Cancel
              </Button>
              {#if three}
                <Button variant="outline" class={TRIO_BUTTON} onclick={() => importReceived(null)}>
                  Add as new
                </Button>
              {/if}
              <Button class={three ? TRIO_BUTTON : PAIR_BUTTON} onclick={retryReceived}>
                Replace
              </Button>
            </div>
          </div>
        {:else if received}
          <div class="flex flex-col items-center py-4 text-center">
            <p class="text-muted-foreground mb-4 break-words">
              {#if receivedStoryNeedsPack}
                Received "{received.envelope.name}". A prompt pack must be selected before
                importing. Import again to choose one, or discard the story.
              {:else}
                Received "{received.envelope.name}". Try importing again, or discard it.
              {/if}
            </p>
            <div class={PAIR_ROW}>
              <Button variant="outline" class={PAIR_BUTTON} onclick={discardReceived}
                >Discard</Button
              >
              <Button class={PAIR_BUTTON} onclick={retryReceived}>Import</Button>
            </div>
          </div>
        {:else if connectedPeer}
          <div class="flex flex-col items-center py-4 text-center">
            <div class="mb-4 flex size-16 items-center justify-center rounded-full bg-green-500/20">
              <Check class="size-8 text-green-500" />
            </div>
            <h3 class="mb-2 text-lg font-semibold break-words">
              Connected to {connectedPeer.name}
            </h3>
            {#if syncMessage}
              <p class="text-muted-foreground break-words">{syncMessage}</p>
            {/if}
            <div class={cn(PAIR_ROW, 'mt-6')}>
              <Button variant="outline" class={PAIR_BUTTON} onclick={showPairing}>Back</Button>
              <Button class={PAIR_BUTTON} onclick={close}>Finish</Button>
            </div>
          </div>
        {:else if serverInfo}
          {#if self}
            <SyncDeviceName name={self.name} onRename={renameDevice} />
          {/if}
          <div class="flex flex-col items-center text-center">
            {#if pairingView === 'code' && connectionCode}
              <SyncCodeDisplay code={connectionCode} />
            {:else}
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
            {/if}
            <p class="text-muted-foreground/60 mt-2 text-xs">
              Server: {serverInfo.ip}:{serverInfo.port}
            </p>
            <Button
              variant="outline"
              class="mt-4"
              onclick={() => (pairingView = pairingView === 'code' ? 'visual' : 'code')}
            >
              {pairingView === 'code' ? 'Show QR code instead' : 'Show a code instead'}
            </Button>
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
            <h3 class="mb-2 text-lg font-semibold">Version mismatch</h3>
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
            <div class={PAIR_ROW}>
              <Button variant="outline" class={PAIR_BUTTON} onclick={cancelVersionMismatch}>
                Cancel
              </Button>
              <Button class={PAIR_BUTTON} onclick={proceedWithVersionMismatch}>Continue</Button>
            </div>
          </div>
        {:else}
          <!-- QR Scanner -->
          {#if self}
            <SyncDeviceName name={self.name} onRename={renameDevice} />
          {/if}
          {#if pairingView === 'visual'}
            <div class="flex flex-col items-center text-center">
              <div
                id={scannerElementId}
                class="mb-4 overflow-hidden rounded-lg bg-black"
                style="width: 300px; height: 300px;"
              ></div>
              <p class="text-muted-foreground text-sm">Point your camera at the QR code</p>
              <Button variant="outline" class="mt-4" onclick={enterCodeInstead}>
                Enter a code instead
              </Button>
            </div>
          {/if}
        {/if}
        {#if pairingView === 'code'}
          <!-- Stays mounted under the warning, which can hand back to it. -->
          <div class={cn(showVersionWarning && 'hidden')}>
            <SyncCodeEntry note={cameraNote} onConnect={pair} onScan={startScanMode} />
          </div>
        {/if}
      {:else if ui.syncMode === 'connected' && connection && self}
        <SyncBrowser
          {connection}
          {self}
          tracking={trackingForExport}
          resolvePack={resolveIncomingPack}
          onApplied={reloadSection}
          onDisconnect={disconnected}
        />
      {/if}
    </div>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>

<!-- Pack step of an in-flight transfer. Opens before anything is written or deleted. -->
{#if packMapping}
  <PackMappingDialog
    context={packMapping.context}
    lockedPack={packMapping.lockedPack}
    onlyVariables={packMapping.onlyVariables}
    onResolve={packMapping.resolve}
  />
{/if}
