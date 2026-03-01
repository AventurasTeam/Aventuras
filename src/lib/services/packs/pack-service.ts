import { database } from '$lib/services/database'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates'
import { hashContent } from './hash'
import type { PresetPack, FullPack } from './types'

/**
 * Pack Service
 *
 * Business logic for preset pack management.
 * Handles default pack initialization, pack creation (copies from default),
 * template modification detection, and safe pack deletion.
 *
 * All database operations are delegated to DatabaseService.
 * This service adds the business rules on top.
 */
class PackService {
  private initialized = false

  /**
   * Initialize the pack system.
   * Call on app startup after database is ready.
   * - Ensures default pack exists
   * - Seeds templates from PROMPT_TEMPLATES if missing
   * - Adds any new templates from app updates
   * Idempotent: safe to call multiple times.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    let defaultPack = await database.getDefaultPack()

    if (!defaultPack) {
      // Create default pack if missing (first run)
      defaultPack = await database.createPack({
        id: 'default-pack',
        name: 'Default',
        description: 'Built-in prompt templates shipped with Aventura',
        author: 'Aventuras',
        isDefault: true,
      })
    }

    // Check existing templates
    const existingTemplates = await database.getPackTemplates('default-pack')
    const existingIds = new Set(existingTemplates.map((t) => t.templateId))

    // Build lookup of existing templates by templateId for quick access
    const existingByTemplateId = new Map(existingTemplates.map((t) => [t.templateId, t]))

    // Seed or update templates from PROMPT_TEMPLATES
    for (const template of PROMPT_TEMPLATES) {
      // Seed system prompt content
      if (!existingIds.has(template.id)) {
        await database.setPackTemplateContent('default-pack', template.id, template.content)
      }
      // Seed user content (if template has it)
      const userContentId = `${template.id}-user`
      if (template.userContent && !existingIds.has(userContentId)) {
        await database.setPackTemplateContent('default-pack', userContentId, template.userContent)
      }
    }

    // Refresh existing default-pack templates when code baseline changes.
    // For each existing template, if its content_hash doesn't match the new code baseline,
    // update it -- UNLESS the user has customized it (content doesn't match any known baseline).
    // Since we can't track old baselines, we accept the tradeoff: default pack templates
    // are auto-updated to match code changes. Users who need custom templates should use
    // custom packs (which are never auto-updated).
    await this.refreshDefaultPackTemplates(existingByTemplateId)

    this.initialized = true
  }

  /**
   * Get all preset packs.
   */
  async getAllPacks(): Promise<PresetPack[]> {
    return database.getAllPacks()
  }

  /**
   * Get a single pack by ID.
   */
  async getPack(id: string): Promise<PresetPack | null> {
    return database.getPack(id)
  }

  /**
   * Load a pack with all its templates and variables.
   */
  async getFullPack(packId: string): Promise<FullPack | null> {
    const pack = await database.getPack(packId)
    if (!pack) return null

    const [templates, variables, runtimeVariables] = await Promise.all([
      database.getPackTemplates(packId),
      database.getPackVariables(packId),
      database.getRuntimeVariables(packId),
    ])

    return { pack, templates, variables, runtimeVariables }
  }

  /** Create a new pack seeded from the pristine PROMPT_TEMPLATES baseline. */
  async createPack(name: string, description?: string, author?: string): Promise<PresetPack> {
    const packId = crypto.randomUUID()

    // Create pack metadata
    const pack = await database.createPack({
      id: packId,
      name,
      description: description ?? null,
      author: author ?? null,
      isDefault: false,
    })

    // Seed templates from code baseline (not from the database default-pack, which may be modified)
    for (const template of PROMPT_TEMPLATES) {
      await database.setPackTemplateContent(packId, template.id, template.content)
      if (template.userContent) {
        await database.setPackTemplateContent(packId, `${template.id}-user`, template.userContent)
      }
    }

    // No custom variables copied — new packs start clean

    return pack
  }

  /**
   * Update pack metadata (name, description, author).
   */
  async updatePack(
    id: string,
    updates: { name?: string; description?: string | null; author?: string | null },
  ): Promise<void> {
    await database.updatePack(id, updates)
  }

  /** Delete a pack. Default pack and packs in use by stories cannot be deleted. */
  async deletePack(packId: string): Promise<{ deleted: boolean; reason?: string }> {
    const pack = await database.getPack(packId)
    if (!pack) return { deleted: false, reason: 'Pack not found' }
    if (pack.isDefault) return { deleted: false, reason: 'Cannot delete the default pack' }

    const canDelete = await database.canDeletePack(packId)
    if (!canDelete) {
      return {
        deleted: false,
        reason: 'Pack is in use by one or more stories. Reassign stories first.',
      }
    }

    await database.deletePack(packId)
    return { deleted: true }
  }

  /**
   * Check if a template in a pack has been modified from the default baseline.
   * Compares the pack template's content hash against the hash of the default content.
   */
  async isTemplateModified(packId: string, templateId: string): Promise<boolean> {
    const packTemplate = await database.getPackTemplate(packId, templateId)
    if (!packTemplate) return false

    // Find default baseline content
    const defaultContent = this.getDefaultContent(templateId)
    if (defaultContent === null) return false

    const defaultHash = await hashContent(defaultContent)
    return packTemplate.contentHash !== defaultHash
  }

  /**
   * Get modification status for all templates in a pack.
   * Returns a map of templateId -> isModified.
   */
  async getModifiedTemplates(packId: string): Promise<Map<string, boolean>> {
    const templates = await database.getPackTemplates(packId)
    const result = new Map<string, boolean>()

    for (const template of templates) {
      const defaultContent = this.getDefaultContent(template.templateId)
      if (defaultContent === null) {
        result.set(template.templateId, false)
        continue
      }
      const defaultHash = await hashContent(defaultContent)
      result.set(template.templateId, template.contentHash !== defaultHash)
    }

    return result
  }

  /** Reset a template to the default baseline content. */
  async resetTemplate(packId: string, templateId: string): Promise<boolean> {
    const defaultContent = this.getDefaultContent(templateId)
    if (defaultContent === null) return false

    await database.setPackTemplateContent(packId, templateId, defaultContent)
    return true
  }

  /**
   * Refresh default pack templates whose code baseline has changed.
   * Only updates templates that haven't been user-modified from their PREVIOUS baseline.
   * Since we can't distinguish "user modified old baseline" from "code changed, user didn't touch",
   * we update all default-pack templates to the current code baseline. Users who customize templates
   * should use custom packs (which are never auto-updated).
   */
  private async refreshDefaultPackTemplates(
    existingByTemplateId: Map<string, { templateId: string; contentHash: string }>,
  ): Promise<void> {
    for (const template of PROMPT_TEMPLATES) {
      // Check system prompt content
      const existing = existingByTemplateId.get(template.id)
      if (existing) {
        const newHash = await hashContent(template.content)
        if (existing.contentHash !== newHash) {
          await database.setPackTemplateContent('default-pack', template.id, template.content)
        }
      }

      // Check user content
      if (template.userContent) {
        const userContentId = `${template.id}-user`
        const existingUser = existingByTemplateId.get(userContentId)
        if (existingUser) {
          const newUserHash = await hashContent(template.userContent)
          if (existingUser.contentHash !== newUserHash) {
            await database.setPackTemplateContent(
              'default-pack',
              userContentId,
              template.userContent,
            )
          }
        }
      }
    }
  }

  /**
   * Get the default baseline content for a template ID.
   * Handles both system prompt (template.id) and user message (template.id + '-user') patterns.
   */
  private getDefaultContent(templateId: string): string | null {
    // Check for user content template (e.g., 'adventure-user')
    if (templateId.endsWith('-user')) {
      const baseId = templateId.replace(/-user$/, '')
      const template = PROMPT_TEMPLATES.find((t) => t.id === baseId)
      return template?.userContent ?? null
    }

    // System prompt content
    const template = PROMPT_TEMPLATES.find((t) => t.id === templateId)
    return template?.content ?? null
  }
}

/** Singleton pack service instance */
export const packService = new PackService()
