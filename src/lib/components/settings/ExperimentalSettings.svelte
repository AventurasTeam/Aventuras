<script module lang="ts">
  // Module-level state persists across component remounts (settings open/close)
  let _sqlQuery = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
  let _queryResult: { columns: string[]; rows: Record<string, unknown>[] } | null = null
  let _queryError: string | null = null
  let _queryTime = 0
  let _showSqlEditor = false
</script>

<script lang="ts">
  import { settings } from '#lib/stores/settings.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import {
    FlaskConical,
    Download,
    Loader2,
    RotateCcw,
    AlertTriangle,
    Database,
    Undo2,
    GitBranch,
    Clock,
    ShieldCheck,
    Terminal,
    Play,
    Copy,
    Upload,
    Smartphone,
    Bell,
    Eye,
  } from '@lucide/svelte'
  import { Switch } from '#lib/components/ui/switch/index.ts'
  import { Label } from '#lib/components/ui/label/index.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Slider } from '#lib/components/ui/slider/index.ts'
  import { Separator } from '#lib/components/ui/separator/index.ts'
  import ActionModal from '#lib/components/shared/ActionModal.svelte'
  import { database } from '#lib/services/database.ts'
  import { story } from '#lib/stores/story.svelte.ts'
  import { isIos } from '#lib/utils/platform.ts'
  import { supportsBackgroundGeneration } from '#lib/utils/backgroundKeepAlive.ts'
  import { autosize } from '#lib/utils/autosize.ts'
  import { ask, open } from '@tauri-apps/plugin-dialog'
  import { openFilters } from '#lib/utils/dialogFilters.ts'
  import { errMessage } from '#lib/utils/error.ts'

  // Local mirror so we can revert the visual state if the confirm dialog is cancelled
  let stateTrackingChecked = $state(settings.experimentalFeatures.stateTracking)
  let closingTracking = $state(false)

  let isBackingUp = $state(false)
  let backupResult = $state<{ success: boolean; message: string } | null>(null)
  let hasEverBackedUp = $state(false)
  let isRestoring = $state(false)
  let restoreError = $state<string | null>(null)
  let showBackupConfirm = $state(false)
  let showRestoreConfirm = $state(false)
  const RESTORE_EXIT_DELAY_MS = 3000
  const onIos = isIos()

  // SQL Query Box state — initialized from module-level persisted values
  let sqlQuery = $state(_sqlQuery)
  let queryResult = $state<{ columns: string[]; rows: Record<string, unknown>[] } | null>(
    _queryResult,
  )
  let queryError = $state<string | null>(_queryError)
  let isQuerying = $state(false)
  let queryTime = $state<number>(_queryTime)
  let showSqlEditor = $state(_showSqlEditor)

  // Sync state back to module-level on change
  $effect(() => {
    _sqlQuery = sqlQuery
  })
  $effect(() => {
    _queryResult = queryResult
  })
  $effect(() => {
    _queryError = queryError
  })
  $effect(() => {
    _queryTime = queryTime
  })
  $effect(() => {
    _showSqlEditor = showSqlEditor
  })

  async function handleRunQuery() {
    if (!sqlQuery.trim()) return
    isQuerying = true
    queryError = null
    queryResult = null
    const start = performance.now()
    try {
      const result = await database.rawQuery(sqlQuery.trim())
      queryTime = Math.round(performance.now() - start)
      queryResult = result
    } catch (error) {
      queryTime = Math.round(performance.now() - start)
      queryError = errMessage(error)
    } finally {
      isQuerying = false
    }
  }

  function handleCopyResults() {
    if (!queryResult) return
    const text = JSON.stringify(queryResult.rows, null, 2)
    navigator.clipboard.writeText(text)
  }

  function handleQueryKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleRunQuery()
    }
  }

  function handleBackup() {
    showBackupConfirm = true
  }

  async function handleBackupConfirmed() {
    showBackupConfirm = false
    isBackingUp = true
    backupResult = null
    try {
      const { backupService } = await import('#lib/services/backupService.ts')
      const savedPath = await backupService.createFullBackup()
      if (savedPath) {
        backupResult = { success: true, message: `Backup saved to:\n${savedPath}` }
        hasEverBackedUp = true
      } else {
        backupResult = { success: false, message: 'Backup cancelled.' }
      }
    } catch (error) {
      console.error('[ExperimentalSettings] Backup failed:', error)
      backupResult = {
        success: false,
        message: `Backup failed: ${errMessage(error)}`,
      }
    } finally {
      isBackingUp = false
    }
  }

  async function handleRestore() {
    showRestoreConfirm = true
  }

  async function handleRestoreConfirmed() {
    showRestoreConfirm = false
    restoreError = null

    // Pick the backup file: a SAF content:// URI on Android, a file:// URL on iOS, a real path on
    // desktop.
    const selected = await open({
      title: 'Select Aventura Backup to Restore',
      // openFilters drops these on Android. It matters here: SAF appends " (1)" AFTER ".zip" for
      // duplicate names, and Android cannot resolve a MIME type for "backup.zip (1)", so a
      // zip-filtered picker would grey out the very backup the user is trying to restore.
      filters: openFilters([
        { name: 'ZIP Archive', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] },
      ]),
      multiple: false,
      directory: false,
    })
    if (!selected) return

    // The native restore opens a path, file:// URL or content:// URI itself.
    await doRestore(selected as string)
  }

  async function doRestore(zipPath: string) {
    isRestoring = true
    restoreError = null
    try {
      const { backupService } = await import('#lib/services/backupService.ts')
      await backupService.restoreFromBackup(zipPath)
    } catch (error) {
      console.error('[ExperimentalSettings] Restore failed:', error)
      restoreError = errMessage(error)
      isRestoring = false
      return
    }

    // The DB is closed and replaced; the blocking modal keeps anything from lazily reopening it.
    ui.restoreComplete = true
    // Give the modal time to paint before the process ends, so the exit doesn't read as a crash.
    await new Promise((resolve) => setTimeout(resolve, RESTORE_EXIT_DELAY_MS))
    // iOS ignores exit(), so the user has to close the app themselves.
    if (isIos()) {
      ui.restoreCloseHint =
        'Restore succeeded. Close Aventuras from the app switcher, then reopen it to continue with the restored database.'
      return
    }
    try {
      // exit() rather than relaunch() avoids a Windows webview2 crash on teardown.
      const { exit } = await import('@tauri-apps/plugin-process')
      await exit(0)
    } catch (error) {
      console.error('[ExperimentalSettings] Exit after restore failed:', error)
      ui.restoreCloseHint = 'Restore succeeded. Please close and relaunch Aventuras.'
    }
  }

  async function handleStateTrackingToggle(checked: boolean) {
    if (checked && !hasEverBackedUp) {
      // Recommend backup before enabling
      const shouldContinue = await ask(
        'It is strongly recommended to download a full backup before enabling experimental features.\n\nWould you like to continue without a backup?',
        { title: 'Enable State Tracking', kind: 'warning' },
      )
      if (!shouldContinue) {
        stateTrackingChecked = !checked // revert visual state
        return
      }
    }
    if (!checked && !(await closeTracking())) {
      stateTrackingChecked = true
      return
    }
    await settings.updateExperimentalFeatures({ stateTracking: checked })
  }

  /**
   * Before tracking goes off: branches must still resolve as they did while tracked. False when
   * the snapshots failed and the reader chose to keep tracking on, since a later attempt
   * can only run while it still is.
   */
  async function closeTracking(): Promise<boolean> {
    closingTracking = true
    try {
      await story.takeClosingSnapshots()
      return true
    } catch (error) {
      console.error('[ExperimentalSettings] Closing snapshots failed:', error)
      return await ask(
        `The closing snapshots could not be saved: ${errMessage(error)}\n\n` +
          'Without them, past checkpoints in what was tracked may be refused. ' +
          'Turn State Tracking off anyway?',
        { title: 'Turn off State Tracking', kind: 'warning' },
      )
    } finally {
      closingTracking = false
    }
  }

  async function handleRollbackToggle(checked: boolean) {
    await settings.updateExperimentalFeatures({ rollbackOnDelete: checked })
  }

  async function handleLightweightBranchesToggle(checked: boolean) {
    await settings.updateExperimentalFeatures({ lightweightBranches: checked })
  }

  async function handleSnapshotIntervalChange(value: number) {
    await settings.updateExperimentalFeatures({ autoSnapshotInterval: value })
  }

  // -- Background generation handlers --

  const showBackgroundSection = supportsBackgroundGeneration()

  async function handleBackgroundGenerationToggle(checked: boolean) {
    if (!checked) {
      // Turning off master toggle cascades to disable sub-toggles (single write)
      await settings.updateExperimentalFeatures({
        backgroundGeneration: false,
        generationNotifications: false,
        notificationPreview: false,
      })
    } else {
      await settings.updateExperimentalFeatures({ backgroundGeneration: true })
    }
  }

  async function handleGenerationNotificationsToggle(checked: boolean) {
    if (checked) {
      // Request notification permission on Android 13+
      try {
        const { isPermissionGranted, requestPermission } =
          await import('@tauri-apps/plugin-notification')
        let granted = await isPermissionGranted()
        if (!granted) {
          const result = await requestPermission()
          granted = result === 'granted'
        }
        if (!granted) {
          // Permission denied — don't enable the toggle
          return
        }
      } catch (e) {
        console.warn('[ExperimentalSettings] Notification permission check failed:', e)
        return
      }
    } else {
      // Turning off notifications cascades to disable preview (single write)
      await settings.updateExperimentalFeatures({
        generationNotifications: false,
        notificationPreview: false,
      })
      return
    }
    await settings.updateExperimentalFeatures({ generationNotifications: checked })
  }

  async function handleNotificationPreviewToggle(checked: boolean) {
    await settings.updateExperimentalFeatures({ notificationPreview: checked })
  }

  async function handleResetAll() {
    if (settings.experimentalFeatures.stateTracking && !(await closeTracking())) return
    await settings.resetExperimentalFeatures()
    stateTrackingChecked = settings.experimentalFeatures.stateTracking
  }
</script>

<div class="space-y-6">
  <!-- Header Banner -->
  <div class="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
    <AlertTriangle class="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
    <div class="space-y-1">
      <p class="text-sm font-medium text-amber-500">Experimental Features</p>
      <p class="text-muted-foreground text-xs">
        These features are in active development. They may change behavior or data formats.
        <strong>Always create a backup before enabling.</strong>
      </p>
    </div>
  </div>

  <!-- Backup Section -->
  <div class="bg-muted/30 space-y-3 rounded-lg border p-4">
    <div class="flex items-center gap-2">
      <ShieldCheck class="text-primary h-4 w-4" />
      <Label class="text-sm font-medium">Data Safety</Label>
    </div>
    <p class="text-muted-foreground text-xs">
      Download a full backup of your database as a ZIP archive. It contains the raw SQLite database,
      which holds every story, lorebook entry and image. You can restore from a backup to revert to
      a previous state.
    </p>
    <div class="flex items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        onclick={handleBackup}
        disabled={isBackingUp || isRestoring}
        class="gap-2"
      >
        {#if isBackingUp}
          <Loader2 class="h-4 w-4 animate-spin" />
          Creating Backup...
        {:else}
          <Download class="h-4 w-4" />
          Download Backup
        {/if}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onclick={handleRestore}
        disabled={isBackingUp || isRestoring}
        class="gap-2"
      >
        {#if isRestoring}
          <Loader2 class="h-4 w-4 animate-spin" />
          Restoring...
        {:else}
          <Upload class="h-4 w-4" />
          Restore from Backup
        {/if}
      </Button>
    </div>
    {#if backupResult}
      <p class="text-xs {backupResult.success ? 'text-green-500' : 'text-destructive'}">
        {backupResult.message}
      </p>
    {/if}
    {#if restoreError}
      <div class="bg-destructive/10 border-destructive/30 rounded-md border p-3">
        <p class="text-destructive text-xs">{restoreError}</p>
      </div>
    {/if}
  </div>

  <Separator />

  <!-- Feature Toggles -->
  <div class="space-y-5">
    <div class="flex items-center gap-2">
      <FlaskConical class="text-muted-foreground h-4 w-4" />
      <Label class="text-sm font-medium">Feature Toggles</Label>
    </div>

    <!-- State Tracking -->
    <div class="flex flex-row items-center justify-between">
      <div class="space-y-0.5">
        <div class="flex items-center gap-2">
          <Database class="text-muted-foreground h-4 w-4" />
          <Label>State Tracking</Label>
        </div>
        <p class="text-muted-foreground text-xs">
          Record every change to the world and the lorebook, and which entry it belongs to. Rollback
          on Delete, regenerate and checkpoints at past entries rebuild state from these records.
        </p>
        {#if closingTracking}
          <p class="text-muted-foreground pt-1 text-xs italic">Saving where tracking stops…</p>
        {:else if settings.experimentalFeatures.stateTracking}
          <p class="pt-1 text-xs font-medium text-amber-500">
            Active — every change to the world and the lorebook is recorded.
          </p>
        {/if}
      </div>
      <Switch
        bind:checked={stateTrackingChecked}
        onCheckedChange={handleStateTrackingToggle}
        disabled={closingTracking}
      />
    </div>

    <!-- Rollback on Delete -->
    <div
      class="flex flex-row items-center justify-between {!settings.experimentalFeatures
        .stateTracking
        ? 'opacity-50'
        : ''}"
    >
      <div class="space-y-0.5">
        <div class="flex items-center gap-2">
          <Undo2 class="text-muted-foreground h-4 w-4" />
          <Label>Rollback on Delete</Label>
        </div>
        <p class="text-muted-foreground text-xs">
          When deleting a message, automatically undo all world state changes from that point
          onward. Entries after the deleted one are also removed (cascade).
        </p>
        {#if !settings.experimentalFeatures.stateTracking}
          <p class="text-muted-foreground pt-1 text-xs italic">
            Requires State Tracking to be enabled.
          </p>
        {:else if settings.experimentalFeatures.rollbackOnDelete}
          <p class="pt-1 text-xs font-medium text-amber-500">
            Active — deleting entries will cascade and rollback state.
          </p>
        {/if}
      </div>
      <Switch
        checked={settings.experimentalFeatures.rollbackOnDelete}
        onCheckedChange={handleRollbackToggle}
        disabled={!settings.experimentalFeatures.stateTracking}
      />
    </div>

    <!-- Lightweight Branches -->
    <div
      class="flex flex-row items-center justify-between {!settings.experimentalFeatures
        .stateTracking
        ? 'opacity-50'
        : ''}"
    >
      <div class="space-y-0.5">
        <div class="flex items-center gap-2">
          <GitBranch class="text-muted-foreground h-4 w-4" />
          <Label>Lightweight Branches</Label>
        </div>
        <p class="text-muted-foreground text-xs">
          New branches share parent world state instead of copying all entities. Changes are
          copy-on-write — only modified entities get duplicated.
        </p>
        {#if !settings.experimentalFeatures.stateTracking}
          <p class="text-muted-foreground pt-1 text-xs italic">
            Requires State Tracking to be enabled.
          </p>
        {:else if settings.experimentalFeatures.lightweightBranches}
          <p class="pt-1 text-xs font-medium text-amber-500">
            Active — new branches will use copy-on-write.
          </p>
        {/if}
      </div>
      <Switch
        checked={settings.experimentalFeatures.lightweightBranches}
        onCheckedChange={handleLightweightBranchesToggle}
        disabled={!settings.experimentalFeatures.stateTracking}
      />
    </div>
  </div>

  <Separator />

  <!-- Snapshot Interval -->
  <div class="space-y-3 {!settings.experimentalFeatures.stateTracking ? 'opacity-50' : ''}">
    <div class="flex items-center gap-2">
      <Clock class="text-muted-foreground h-4 w-4" />
      <Label>Auto-Snapshot Interval</Label>
    </div>
    <p class="text-muted-foreground text-xs">
      Number of entries between automatic world state snapshots. A checkpoint at a past entry is
      rebuilt from the nearest snapshot after it, so lower values keep that closer but use more
      storage.
    </p>
    <div class="flex items-center gap-4">
      <Slider
        type="single"
        value={settings.experimentalFeatures.autoSnapshotInterval}
        onValueChange={handleSnapshotIntervalChange}
        min={5}
        max={100}
        step={5}
        disabled={!settings.experimentalFeatures.stateTracking}
        class="flex-1"
      />
      <span class="text-muted-foreground w-12 text-right font-mono text-sm">
        {settings.experimentalFeatures.autoSnapshotInterval}
      </span>
    </div>
  </div>

  <Separator />

  <!-- Background Generation (Android and iOS) -->
  {#if showBackgroundSection}
    <div class="space-y-5">
      <div class="flex items-center gap-2">
        <Smartphone class="text-muted-foreground h-4 w-4" />
        <Label class="text-sm font-medium">Background Generation</Label>
      </div>

      <!-- Background Generation toggle -->
      <div class="flex flex-row items-center justify-between">
        <div class="space-y-0.5">
          <div class="flex items-center gap-2">
            <Smartphone class="text-muted-foreground h-4 w-4" />
            <Label>Background Generation</Label>
          </div>
          <p class="text-muted-foreground text-xs">
            Keeps the app alive during text generation when you switch apps or lock your screen.
            {#if onIos}
              Uses a system background task, shown in the Dynamic Island, and an inaudible audio
              loop that keeps the story page running — may use slightly more battery. iOS can still
              end the task early.
            {:else}
              Uses a foreground service and wake lock — may use slightly more battery.
            {/if}
          </p>
          {#if settings.experimentalFeatures.backgroundGeneration}
            <p class="pt-1 text-xs font-medium text-amber-500">
              Active — generation will continue when the app is backgrounded.
            </p>
          {/if}
        </div>
        <Switch
          checked={settings.experimentalFeatures.backgroundGeneration}
          onCheckedChange={handleBackgroundGenerationToggle}
        />
      </div>

      <!-- Generation Notifications toggle -->
      <div
        class="flex flex-row items-center justify-between {!settings.experimentalFeatures
          .backgroundGeneration
          ? 'opacity-50'
          : ''}"
      >
        <div class="space-y-0.5">
          <div class="flex items-center gap-2">
            <Bell class="text-muted-foreground h-4 w-4" />
            <Label>Completion Notifications</Label>
          </div>
          <p class="text-muted-foreground text-xs">
            Send a notification when text generation finishes while the app is in the background.
          </p>
          {#if !settings.experimentalFeatures.backgroundGeneration}
            <p class="text-muted-foreground pt-1 text-xs italic">
              Requires Background Generation to be enabled.
            </p>
          {/if}
        </div>
        <Switch
          checked={settings.experimentalFeatures.generationNotifications}
          onCheckedChange={handleGenerationNotificationsToggle}
          disabled={!settings.experimentalFeatures.backgroundGeneration}
        />
      </div>

      <!-- Notification Preview toggle -->
      <div
        class="flex flex-row items-center justify-between {!settings.experimentalFeatures
          .generationNotifications
          ? 'opacity-50'
          : ''}"
      >
        <div class="space-y-0.5">
          <div class="flex items-center gap-2">
            <Eye class="text-muted-foreground h-4 w-4" />
            <Label>Include Preview</Label>
          </div>
          <p class="text-muted-foreground text-xs">
            Show the first few lines of generated text in the notification body.
          </p>
          {#if !settings.experimentalFeatures.generationNotifications}
            <p class="text-muted-foreground pt-1 text-xs italic">
              Requires Completion Notifications to be enabled.
            </p>
          {/if}
        </div>
        <Switch
          checked={settings.experimentalFeatures.notificationPreview}
          onCheckedChange={handleNotificationPreviewToggle}
          disabled={!settings.experimentalFeatures.generationNotifications}
        />
      </div>

      {#if !onIos}
        <p class="text-muted-foreground text-xs italic">
          Note: Some phone manufacturers (Xiaomi, Huawei, Samsung, etc.) have aggressive battery
          optimization that may still interrupt generation. You may need to exempt Aventura from
          battery optimization in your device settings.
        </p>
      {/if}
    </div>

    <Separator />
  {/if}

  <!-- Reset Button -->
  <div class="flex items-center justify-between">
    <div class="space-y-0.5">
      <p class="text-sm font-medium">Reset Experimental Features</p>
      <p class="text-muted-foreground text-xs">
        Disable all experimental features and reset to defaults.
      </p>
    </div>
    <Button
      variant="outline"
      size="sm"
      onclick={handleResetAll}
      disabled={closingTracking}
      class="gap-2"
    >
      <RotateCcw class="h-4 w-4" />
      Reset
    </Button>
  </div>

  <Separator />

  <!-- SQL Query Console Toggle -->
  <div class="flex flex-row items-center justify-between">
    <div class="space-y-0.5">
      <div class="flex items-center gap-2">
        <Terminal class="text-muted-foreground h-4 w-4" />
        <Label>SQL Query Console</Label>
      </div>
      <p class="text-muted-foreground text-xs">
        Run raw SQL queries directly against the internal SQLite database.
      </p>
    </div>
    <Switch checked={showSqlEditor} onCheckedChange={(v) => (showSqlEditor = v)} />
  </div>

  {#if showSqlEditor}
    <div class="space-y-3">
      <div
        class="bg-destructive/10 border-destructive/30 flex items-start gap-3 rounded-lg border p-3"
      >
        <AlertTriangle class="text-destructive mt-0.5 h-4 w-4 shrink-0" />
        <p class="text-destructive text-xs">
          <strong>Danger zone.</strong> Write queries (INSERT, UPDATE, DELETE, DROP) can permanently
          modify or corrupt your data. Always create a backup first. Press
          <kbd class="bg-destructive/20 rounded px-1 py-0.5 font-mono text-[10px]">Ctrl+Enter</kbd> to
          run.
        </p>
      </div>

      <!-- Query Input -->
      <textarea
        bind:value={sqlQuery}
        use:autosize={{ enabled: true, value: sqlQuery }}
        onkeydown={handleQueryKeydown}
        placeholder="SELECT * FROM stories LIMIT 10;"
        spellcheck={false}
        class="bg-surface-950 border-surface-700 text-foreground placeholder:text-muted-foreground max-h-[50dvh] w-full resize-none rounded-md border p-3 font-mono text-xs leading-relaxed focus:ring-1 focus:ring-amber-500/50 focus:outline-none"
        rows={4}></textarea>

      <!-- Actions -->
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onclick={handleRunQuery}
          disabled={isQuerying || !sqlQuery.trim()}
          class="gap-2"
        >
          {#if isQuerying}
            <Loader2 class="h-4 w-4 animate-spin" />
            Running...
          {:else}
            <Play class="h-4 w-4" />
            Run Query
          {/if}
        </Button>
        {#if queryResult}
          <Button variant="ghost" size="sm" onclick={handleCopyResults} class="gap-2">
            <Copy class="h-4 w-4" />
            Copy JSON
          </Button>
          <span class="text-muted-foreground text-xs">
            {queryResult.rows.length} row{queryResult.rows.length !== 1 ? 's' : ''} in {queryTime}ms
          </span>
        {/if}
      </div>

      <!-- Error -->
      {#if queryError}
        <div class="bg-destructive/10 border-destructive/30 rounded-md border p-3">
          <p class="text-destructive font-mono text-xs whitespace-pre-wrap">{queryError}</p>
        </div>
      {/if}

      <!-- Results Table -->
      {#if queryResult && queryResult.rows.length > 0}
        <div class="border-surface-700 max-h-72 overflow-auto rounded-md border">
          <table class="w-full text-xs">
            <thead class="bg-surface-800 sticky top-0">
              <tr>
                {#each queryResult.columns as col, ci (ci)}
                  <th
                    class="border-surface-700 text-muted-foreground border-b px-3 py-2 text-left font-medium"
                  >
                    {col}
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each queryResult.rows as row, i (i)}
                <tr class="border-surface-700/50 hover:bg-surface-800/50 border-b last:border-b-0">
                  {#each queryResult.columns as col, ci (ci)}
                    <td
                      class="text-foreground max-w-xs truncate px-3 py-1.5 font-mono"
                      title={String(row[col] ?? '')}
                    >
                      {row[col] === null ? 'NULL' : row[col]}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else if queryResult && queryResult.rows.length === 0}
        <p class="text-muted-foreground text-xs italic">Query returned no rows.</p>
      {/if}
    </div>
  {/if}
</div>

{#snippet warning()}
  <AlertTriangle class="h-5 w-5 text-amber-500" />
{/snippet}

<ActionModal
  bind:open={showBackupConfirm}
  title="Backup Contains Sensitive Data"
  titleIcon={warning}
  action={{ label: 'Continue', icon: Download, onConfirm: handleBackupConfirmed }}
>
  {#snippet description()}
    <span class="block space-y-3 pt-2">
      <span class="block">
        The backup includes your <strong>full settings</strong>, which contain your
        <strong class="text-destructive">API keys</strong> and
        <strong class="text-destructive">API provider profiles</strong>.
      </span>
      <span class="block font-medium text-amber-500">
        Do not share this file with others — anyone with the backup can access your API keys.
      </span>
    </span>
  {/snippet}
</ActionModal>

<ActionModal
  bind:open={showRestoreConfirm}
  title="Restore from Backup"
  titleIcon={warning}
  action={{
    label: onIos ? 'Restore' : 'Restore & Close App',
    icon: Upload,
    tone: 'overwrite',
    onConfirm: handleRestoreConfirmed,
  }}
>
  {#snippet description()}
    <span class="block space-y-3 pt-2">
      <span class="block">
        This will <strong class="text-destructive">replace your entire database</strong> with the one
        from the backup ZIP.
      </span>
      <span class="block">
        A safety copy of your current database will be saved as
        <span class="font-mono text-xs">aventura-pre-restore.db</span> in the app data folder.
      </span>
      <span class="block font-medium text-amber-500">
        {#if onIos}
          iOS cannot close the app for you. After restoring, close Aventuras from the app switcher,
          then reopen it.
        {:else}
          The application will close after restoring. You will need to reopen it manually.
        {/if}
      </span>
    </span>
  {/snippet}
</ActionModal>
