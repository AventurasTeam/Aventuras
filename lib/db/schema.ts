import { appSettings } from './app-settings/app-settings.table'
import { assets, entryAssets } from './assets/assets.table'
import { characterRelationships, entities } from './entities/entities.table'
import {
  happeningAwareness,
  happeningInvolvements,
  happenings,
} from './happenings/happenings.table'
import { lore } from './lore/lore.table'
import { branchEraFlips, branches, stories } from './stories/stories.table'
import { chapters, storyEntries } from './story-entries/story-entries.table'
import { deltas, pipelineRuns, probeCaptures, vaultCalendars } from './system/system.table'
import { threads } from './threads/threads.table'
import { translations } from './translations/translations.table'
import { wizardSessions } from './wizard-sessions/wizard-sessions.table'

export {
  appSettings,
  assets,
  branchEraFlips,
  branches,
  chapters,
  characterRelationships,
  deltas,
  entities,
  entryAssets,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  pipelineRuns,
  probeCaptures,
  stories,
  storyEntries,
  threads,
  translations,
  vaultCalendars,
  wizardSessions,
}

export const dbSchema = {
  stories,
  branches,
  storyEntries,
  entities,
  lore,
  threads,
  happenings,
  happeningInvolvements,
  happeningAwareness,
  characterRelationships,
  chapters,
  branchEraFlips,
  translations,
  probeCaptures,
  assets,
  entryAssets,
  vaultCalendars,
  appSettings,
  pipelineRuns,
  deltas,
  wizardSessions,
}
