/**
 * Entity Viewer Tools
 *
 * Tool definitions for opening vault entities in the editor panel
 * for viewing and manual editing. Used by InteractiveVaultService.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { VaultCharacter, VaultLorebook, VaultScenario } from '$lib/types'
import type { VaultPendingChange } from '../schemas/vault'

/**
 * Context provided to viewer tools.
 */
export interface ViewerToolContext {
  /** Getter for current vault characters (live, not snapshot) */
  characters: () => VaultCharacter[]
  /** Getter for current vault scenarios (live, not snapshot) */
  scenarios: () => VaultScenario[]
  /** Getter for current vault lorebooks (live, not snapshot) */
  lorebooks: () => VaultLorebook[]
  /** Callback to show an entity in the viewer panel */
  onShowEntity: (change: VaultPendingChange, entityId: string, entityType: string) => void
  /** Generate unique ID for synthetic changes */
  generateId: () => string
}

/**
 * Create entity viewer tools with the given context.
 */
export function createViewerTools(context: ViewerToolContext) {
  const { characters, scenarios, lorebooks, onShowEntity, generateId } = context

  return {
    /**
     * Open an entity in the viewer/editor panel for the user to see and edit.
     */
    show_entity: tool({
      description:
        'Open a vault entity (character, scenario, or lorebook) in the editor panel so the user can view and manually edit it. Use this when the user asks to see, show, open, or view an entity.',
      inputSchema: z.object({
        entityType: z
          .enum(['character', 'scenario', 'lorebook'])
          .describe('Type of entity to show'),
        entityId: z.string().describe('ID of the entity to show'),
      }),
      execute: async ({
        entityType,
        entityId,
      }: {
        entityType: 'character' | 'scenario' | 'lorebook'
        entityId: string
      }) => {
        const changeId = generateId()

        if (entityType === 'character') {
          const character = characters().find((c) => c.id === entityId)
          if (!character) {
            return { success: false, error: `Character with ID "${entityId}" not found` }
          }

          const syntheticChange: VaultPendingChange = {
            id: changeId,
            toolCallId: changeId,
            entityType: 'character',
            action: 'create',
            data: {
              name: character.name,
              description: character.description,
              traits: character.traits,
              visualDescriptors: character.visualDescriptors,
              portrait: character.portrait,
              tags: character.tags,
              favorite: character.favorite,
            },
            status: 'approved',
          }

          onShowEntity(syntheticChange, entityId, entityType)
          return {
            success: true,
            message: `Opened character "${character.name}" in the editor panel.`,
          }
        }

        if (entityType === 'scenario') {
          const scenario = scenarios().find((s) => s.id === entityId)
          if (!scenario) {
            return { success: false, error: `Scenario with ID "${entityId}" not found` }
          }

          const syntheticChange: VaultPendingChange = {
            id: changeId,
            toolCallId: changeId,
            entityType: 'scenario',
            action: 'create',
            data: {
              name: scenario.name,
              description: scenario.description,
              settingSeed: scenario.settingSeed,
              npcs: scenario.npcs,
              primaryCharacterName: scenario.primaryCharacterName,
              firstMessage: scenario.firstMessage,
              alternateGreetings: scenario.alternateGreetings,
              tags: scenario.tags,
              favorite: scenario.favorite,
            },
            status: 'approved',
          }

          onShowEntity(syntheticChange, entityId, entityType)
          return {
            success: true,
            message: `Opened scenario "${scenario.name}" in the editor panel.`,
          }
        }

        if (entityType === 'lorebook') {
          const lorebook = lorebooks().find((l) => l.id === entityId)
          if (!lorebook) {
            return { success: false, error: `Lorebook with ID "${entityId}" not found` }
          }

          const syntheticChange: VaultPendingChange = {
            id: changeId,
            toolCallId: changeId,
            entityType: 'lorebook',
            action: 'update',
            entityId,
            data: {
              name: lorebook.name,
              description: lorebook.description,
              tags: lorebook.tags,
            },
            status: 'approved',
          }

          onShowEntity(syntheticChange, entityId, entityType)
          return {
            success: true,
            message: `Opened lorebook "${lorebook.name}" in the editor panel.`,
          }
        }

        return { success: false, error: `Unknown entity type: ${entityType}` }
      },
    }),
  }
}

export type ViewerTools = ReturnType<typeof createViewerTools>
