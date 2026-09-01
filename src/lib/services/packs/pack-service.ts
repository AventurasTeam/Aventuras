import { database } from '$lib/services/database'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates'
import { hashContent } from './hash'
import {
  classifyTemplates,
  isUntouched,
  type ClassifiedTemplates,
  type RefreshScope,
} from './staleness'
import type { PresetPack, FullPack, PackTemplate } from './types'

export { isUntouched } from './staleness'

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
        await database.setPackTemplateContent('default-pack', template.id, template.content, true)
      }
      // Seed user content (if template has it)
      const userContentId = `${template.id}-user`
      if (template.userContent && !existingIds.has(userContentId)) {
        await database.setPackTemplateContent(
          'default-pack',
          userContentId,
          template.userContent,
          true,
        )
      }
    }

    // Refresh existing default-pack templates when code baseline changes.
    // For each existing template, if its content_hash doesn't match the new code baseline,
    // update it -- UNLESS the user has customized it (content doesn't match any known baseline).
    // Since we can't track old baselines, we accept the tradeoff: default pack templates
    // are auto-updated to match code changes. Users who need custom templates should use
    // custom packs (which are never auto-updated).
    await this.refreshDefaultPackTemplates(existingByTemplateId)

    await this.backfillMissingTemplates()

    this.initialized = true
  }

  /**
   * Add templates that exist in the code baseline but not yet in a pack.
   *
   * Custom packs are seeded once from PROMPT_TEMPLATES at creation and are deliberately
   * never auto-updated, so a template *added* by a later app version is simply absent
   * from them. Backfilling gives the user something they can actually open and edit in
   * the template editor, which a runtime fallback alone would not.
   *
   * This is the persistence half; `ContextBuilder.resolveTemplate` is the safety half and
   * neither replaces the other. The fallback there still matters for packs this never
   * reaches -- one imported from a file after startup, or a row that fails to write --
   * where a missing id would otherwise render an empty prompt and the service would
   * silently issue a contentless request.
   *
   * Only ever inserts, so a user's edits to templates they already have are untouched.
   */
  private async backfillMissingTemplates(): Promise<void> {
    const packs = await database.getAllPacks()

    for (const pack of packs) {
      const existing = await database.getPackTemplates(pack.id)
      const existingIds = new Set(existing.map((t) => t.templateId))

      // id -> content for everything missing, built before touching the database so the
      // common case (nothing missing) does no writes and logs nothing.
      const missing = new Map<string, string>()
      for (const template of PROMPT_TEMPLATES) {
        if (!existingIds.has(template.id)) missing.set(template.id, template.content)
        const userId = `${template.id}-user`
        if (template.userContent && !existingIds.has(userId)) {
          missing.set(userId, template.userContent)
        }
      }
      if (missing.size === 0) continue

      for (const [templateId, content] of missing) {
        await database.setPackTemplateContent(pack.id, templateId, content, true)
      }
      console.log('[PackService] Backfilled missing templates', {
        pack: pack.id,
        added: [...missing.keys()],
      })
    }
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
      await database.setPackTemplateContent(packId, template.id, template.content, true)
      if (template.userContent) {
        await database.setPackTemplateContent(
          packId,
          `${template.id}-user`,
          template.userContent,
          true,
        )
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

  /**
   * Split a pack's edited templates by whether the app has shipped newer text for them.
   *
   * Returned as template ids; the caller names them for display. Ids the app no longer ships
   * appear in neither group -- there is nothing to compare them against.
   */
  async classifyPackTemplates(packId: string): Promise<ClassifiedTemplates> {
    const rows = await database.getPackTemplates(packId)

    const shippedHashes = new Map(
      await Promise.all(
        rows.map(async (row) => {
          const shipped = this.getDefaultContent(row.templateId)
          return [row.templateId, shipped === null ? undefined : await hashContent(shipped)] as [
            string,
            string | undefined,
          ]
        }),
      ).then((entries) => entries.filter((e): e is [string, string] => e[1] !== undefined)),
    )

    return classifyTemplates(rows, shippedHashes)
  }

  /**
   * Return a pack's edited templates to the shipped text, at the scope the user chose.
   *
   * `'behind'` takes only the templates the app has changed since; `'edited'` takes every
   * edit, which is what keeps a set of related customisations coherent rather than leaving
   * half of it against the other half's replacement.
   *
   * Restricted to the default pack: a custom pack's baseline is not the shipped text -- for
   * an imported pack it is the file its author wrote, so this would overwrite their prompts
   * rather than restore anything.
   */
  async refreshTemplates(packId: string, scope: RefreshScope): Promise<number> {
    const pack = await database.getPack(packId)
    if (!pack) throw new Error('Pack not found')
    if (!pack.isDefault) {
      throw new Error(
        'Only the built-in pack can be refreshed from the shipped prompts — a custom pack’s templates came from its author, not from the app.',
      )
    }

    const { behind, customised } = await this.classifyPackTemplates(packId)
    const templateIds = scope === 'behind' ? behind : [...behind, ...customised]
    if (templateIds.length === 0) return 0

    const rows = await Promise.all(
      templateIds.map(async (templateId) => {
        const content = this.getDefaultContent(templateId)!
        return { templateId, content, contentHash: await hashContent(content) }
      }),
    )

    await database.refreshPackTemplatesToShipped(packId, rows)
    return rows.length
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

    await database.setPackTemplateContent(packId, templateId, defaultContent, true)
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
    existingByTemplateId: Map<string, PackTemplate>,
  ): Promise<void> {
    for (const template of PROMPT_TEMPLATES) {
      // Check system prompt content
      const existing = existingByTemplateId.get(template.id)
      if (existing && isUntouched(existing)) {
        const newHash = await hashContent(template.content)
        if (existing.contentHash !== newHash) {
          await database.setPackTemplateContent('default-pack', template.id, template.content, true)
        }
      }

      // Check user content
      if (template.userContent) {
        const userContentId = `${template.id}-user`
        const existingUser = existingByTemplateId.get(userContentId)
        if (existingUser && isUntouched(existingUser)) {
          const newUserHash = await hashContent(template.userContent)
          if (existingUser.contentHash !== newUserHash) {
            await database.setPackTemplateContent(
              'default-pack',
              userContentId,
              template.userContent,
              true,
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
