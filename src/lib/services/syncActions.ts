import type { SyncConnectionData } from '$lib/types/sync'
import type { ImportResult, PackBindingResolution } from './import'
import { exportService } from './export'
import { syncService } from './sync'

export async function pushSyncedStory(
  connection: SyncConnectionData,
  storyId: string,
): Promise<void> {
  const storyJson = await syncService.exportStoryToJson(storyId)
  await syncService.pushStory(connection, storyJson)
}

export async function importSyncedStory(
  storyJson: string,
  existingStoryId: string | null,
  packBinding: PackBindingResolution,
): Promise<ImportResult> {
  if (existingStoryId) await syncService.deleteStory(existingStoryId)

  return exportService.importFromContent(storyJson, true, {
    resolvePackBinding: async () => packBinding,
  })
}
