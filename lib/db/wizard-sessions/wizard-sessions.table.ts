import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { WizardWorkingState } from './working-state'

export const wizardSessions = sqliteTable('wizard_sessions', {
  id: text('id').primaryKey(),
  storyId: text('story_id'),
  state: text('state', { mode: 'json' }).$type<WizardWorkingState>().notNull(),
  updatedAt: integer('updated_at').notNull(),
})
