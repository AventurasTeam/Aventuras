<script module lang="ts">
  // Module-level state persists across component remounts (settings open/close)
  let _sqlQuery = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
  let _queryResult: { columns: string[]; rows: Record<string, unknown>[] } | null = null
  let _queryError: string | null = null
  let _queryTime = 0
  let _showSqlEditor = false
</script>

<script lang="ts">
  import { settings } from '$lib/stores/settings.svelte'
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
  } from 'lucide-svelte'
  import { Switch } from '$lib/components/ui/switch'
  import { Label } from '$lib/components/ui/label'
  import { Button } from '$lib/components/ui/button'
  import { Slider } from '$lib/components/ui/slider'
  import { Separator } from '$lib/components/ui/separator'
  import * as Dialog from '$lib/components/ui/dialog'
  import { database } from '$lib/services/database'

  let isBackingUp = $state(false)
  let backupResult = $state<{ success: boolean; message: string } | null>(null)
  let hasEverBackedUp = $state(false)
  let isRestoring = $state(false)
  let restoreError = $state<string | null>(null)
  let showBackupConfirm = $state(false)
  let showRestoreConfirm = $state(false)

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
      queryError = error instanceof Error ? error.message : String(error)
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
      const { backupService } = await import('$lib/services/backupService')
      const result = await backupService.createFullBackup()
      if (result) {
        backupResult = { success: true, message: 'Backup created successfully!' }
        hasEverBackedUp = true
      } else {
        backupResult = { success: false, message: 'Backup cancelled.' }
      }
    } catch (error) {
      console.error('[ExperimentalSettings] Backup failed:', error)
      backupResult = {
        success: false,
        message: `Backup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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

    // Open file picker AFTER confirmation
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      title: 'Select Aventura Backup to Restore',
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      multiple: false,
      directory: false,
    })
    if (!selected) return

    isRestoring = true
    restoreError = null
    try {
      const { backupService } = await import('$lib/services/backupService')
      await backupService.restoreFromBackup(selected as string)
      // App will exit — we won't reach here
    } catch (error) {
      console.error('[ExperimentalSettings] Restore failed:', error)
      restoreError = error instanceof Error ? error.message : String(error)
    } finally {
      isRestoring = false
    }
  }

  async function handleStateTrackingToggle(checked: boolean) {
    if (checked && !hasEverBackedUp) {
      // Recommend backup before enabling
      const shouldContinue = confirm(
        'It is strongly recommended to download a full backup before enabling experimental features.\n\nWould you like to continue without a backup?',
      )
      if (!shouldContinue) return
    }
    await settings.updateExperimentalFeatures({ stateTracking: checked })
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

  async function handleResetAll() {
    await settings.resetExperimentalFeatures()
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
      Download a full backup of your database and all stories as a ZIP archive. Includes the raw
      SQLite database and individual story exports (.avt) for maximum safety. You can restore from a
      backup to revert to a previous state.
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
      {#if backupResult}
        <p class="text-xs {backupResult.success ? 'text-green-500' : 'text-destructive'}">
          {backupResult.message}
        </p>
      {/if}
    </div>
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
          Record world state changes (deltas) on each story entry after AI classification. This is
          the foundation for rollback and lightweight branches.
        </p>
        {#if settings.experimentalFeatures.stateTracking}
          <p class="pt-1 text-xs font-medium text-amber-500">
            Active — deltas will be recorded on new entries.
          </p>
        {/if}
      </div>
      <Switch
        checked={settings.experimentalFeatures.stateTracking}
        onCheckedChange={handleStateTrackingToggle}
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
      Number of entries between automatic world state snapshots. Lower values allow faster rollback
      but use more storage.
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

  <!-- Reset Button -->
  <div class="flex items-center justify-between">
    <div class="space-y-0.5">
      <p class="text-sm font-medium">Reset Experimental Features</p>
      <p class="text-muted-foreground text-xs">
        Disable all experimental features and reset to defaults.
      </p>
    </div>
    <Button variant="outline" size="sm" onclick={handleResetAll} class="gap-2">
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
        onkeydown={handleQueryKeydown}
        placeholder="SELECT * FROM stories LIMIT 10;"
        spellcheck={false}
        class="bg-surface-950 border-surface-700 text-foreground placeholder:text-muted-foreground w-full rounded-md border p-3 font-mono text-xs leading-relaxed focus:ring-1 focus:ring-amber-500/50 focus:outline-none"
        rows={4}
      ></textarea>

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
                {#each queryResult.columns as col (col)}
                  <th
                    class="border-surface-700 text-muted-foreground border-b px-3 py-2 text-left font-medium"
                  >
                    {col}
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each queryResult.rows as row (JSON.stringify(row))}
                <tr class="border-surface-700/50 hover:bg-surface-800/50 border-b last:border-b-0">
                  {#each queryResult.columns as col (col)}
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

<!-- Backup Warning Dialog -->
<Dialog.Root bind:open={showBackupConfirm}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <AlertTriangle class="h-5 w-5 text-amber-500" />
        Backup Contains Sensitive Data
      </Dialog.Title>
      <Dialog.Description class="space-y-3 pt-2">
        <p>
          The backup includes your <strong>full settings</strong>, which contain your
          <strong class="text-destructive">API keys</strong> and
          <strong class="text-destructive">API provider profiles</strong>.
        </p>
        <p class="font-medium text-amber-500">
          Do not share this file with others — anyone with the backup can access your API keys.
        </p>
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer class="gap-2 sm:gap-0">
      <Button variant="outline" onclick={() => (showBackupConfirm = false)}>Cancel</Button>
      <Button onclick={handleBackupConfirmed} class="gap-2">
        <Download class="h-4 w-4" />
        Continue
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Restore Confirmation Dialog -->
<Dialog.Root bind:open={showRestoreConfirm}>
  <Dialog.Content class="p-6 sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <AlertTriangle class="h-5 w-5 text-amber-500" />
        Restore from Backup
      </Dialog.Title>
      <Dialog.Description class="space-y-3 pt-2">
        <p>
          This will <strong class="text-destructive">replace your entire database</strong> with the one
          from the backup ZIP.
        </p>
        <p>
          A safety copy of your current database will be saved as
          <span class="font-mono text-xs">aventura-pre-restore.db</span> in the app data folder.
        </p>
        <p class="font-medium text-amber-500">
          The application will close after restoring. You will need to reopen it manually.
        </p>
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer class="mt-4 justify-between sm:justify-between">
      <Button variant="outline" onclick={() => (showRestoreConfirm = false)}>Cancel</Button>
      <Button
        variant="outline"
        onclick={handleRestoreConfirmed}
        class="border-destructive text-destructive hover:bg-destructive/10 gap-2"
      >
        <Upload class="h-4 w-4" />
        Restore & Close App
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
