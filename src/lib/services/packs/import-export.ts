import { open } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import { resolveSaveTarget } from '$lib/services/exportTarget'
import { packService } from './pack-service'
import { database } from '$lib/services/database'
import { validatePackImport, type PackExport } from './validation'
import { templateEngine } from '$lib/services/templates/engine'
import { hashContent } from './hash'
import { packUpdateSummary, type PackUpdateSummary } from './update-summary'
import type { PresetPack } from './types'

interface TemplateError {
  templateId: string
  error: string
}

export interface ImportValidationResult {
  valid: boolean
  structuralErrors: string[]
  templateErrors: TemplateError[]
  pack?: PackExport
}

/**
 * How a name collision on import is settled. Replacing an existing pack is not one of
 * them: that is `updatePackFromFile`, reached from the pack itself rather than from a name
 * that happens to match.
 */
export type ConflictStrategy = 'rename' | 'cancel'

class ImportExportService {
  async exportPack(packId: string): Promise<boolean> {
    const fullPack = await packService.getFullPack(packId)
    if (!fullPack) return false

    const exportData: PackExport = {
      version: 1,
      name: fullPack.pack.name,
      description: fullPack.pack.description ?? undefined,
      author: fullPack.pack.author ?? undefined,
      templates: fullPack.templates.map((t) => ({
        templateId: t.templateId,
        content: t.content,
      })),
      variables: fullPack.variables.map((v) => ({
        variableName: v.variableName,
        displayName: v.displayName,
        variableType: v.variableType,
        isRequired: v.isRequired,
        defaultValue: v.defaultValue,
        enumOptions: v.enumOptions,
        description: v.description,
        sortOrder: v.sortOrder,
      })),
    }

    const suggestedName =
      fullPack.pack.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') + '.prompt.json'

    const target = await resolveSaveTarget(suggestedName, [
      { name: 'Prompt Pack', extensions: ['prompt.json'] },
    ])
    if (!target) return false

    await writeTextFile(target.destPath, JSON.stringify(exportData))
    return true
  }

  async pickAndReadImportFile(): Promise<string | null> {
    try {
      const filePath = await open({
        filters: [{ name: 'Prompt Pack', extensions: ['prompt.json', 'json'] }],
        multiple: false,
      })

      if (!filePath || typeof filePath !== 'string') return null

      return await readTextFile(filePath)
    } catch (e) {
      console.error('[ImportExportService] Failed to pick/read file:', e)
      return null
    }
  }

  validateImport(rawJson: string): ImportValidationResult {
    let data: unknown
    try {
      data = JSON.parse(rawJson)
    } catch {
      return { valid: false, structuralErrors: ['Invalid JSON file'], templateErrors: [] }
    }

    const zodResult = validatePackImport(data)
    if (!zodResult.valid) {
      return {
        valid: false,
        structuralErrors: zodResult.errors ?? [],
        templateErrors: [],
      }
    }

    const templateErrors: TemplateError[] = []
    for (const template of zodResult.pack!.templates) {
      const parseResult = templateEngine.parseTemplate(template.content)
      if (!parseResult.success) {
        templateErrors.push({
          templateId: template.templateId,
          error: parseResult.error ?? 'Unknown parse error',
        })
      }
    }

    return {
      valid: templateErrors.length === 0,
      structuralErrors: [],
      templateErrors,
      pack: zodResult.pack,
    }
  }

  async checkNameConflict(packName: string): Promise<PresetPack | null> {
    const allPacks = await packService.getAllPacks()
    const lowerName = packName.toLowerCase()
    return allPacks.find((p) => p.name.toLowerCase() === lowerName) ?? null
  }

  /** What updating `packId` from this file would discard, for the confirmation. */
  async summarizeUpdate(packId: string, packData: PackExport): Promise<PackUpdateSummary> {
    const [currentTemplates, currentVariables, storyCount] = await Promise.all([
      database.getPackTemplates(packId),
      database.getPackVariables(packId),
      database.getPackUsageCount(packId),
    ])

    return packUpdateSummary({ currentTemplates, currentVariables, packData, storyCount })
  }

  /**
   * Replace an existing pack's contents with a file's, keeping its id and its name.
   *
   * The built-in pack is excluded because `PackService.refreshDefaultPackTemplates` rewrites
   * it from the app's own templates on startup: an import writes rows as their own baseline,
   * so every one of them would read as untouched and be overwritten on the next launch.
   */
  async updatePackFromFile(packId: string, packData: PackExport): Promise<void> {
    const pack = await packService.getPack(packId)
    if (!pack) throw new Error('Pack not found')
    if (pack.isDefault) {
      throw new Error(
        'The built-in pack cannot be updated from a file — it is rewritten from the app’s own templates on every launch.',
      )
    }

    const hashes = new Map(
      await Promise.all(
        packData.templates.map(
          async (t) => [t.templateId, await hashContent(t.content)] as [string, string],
        ),
      ),
    )

    await database.replacePackContents(packId, packData, hashes)
  }

  async applyImport(packData: PackExport, strategy: ConflictStrategy): Promise<string | null> {
    if (strategy === 'cancel') return null

    let finalName = packData.name
    if (strategy === 'rename') {
      let suffix = ''
      let attempt = 0
      while (await this.checkNameConflict(finalName + suffix)) {
        attempt++
        suffix = attempt === 1 ? ' (Imported)' : ` (Imported ${attempt})`
      }
      finalName = finalName + suffix
    }

    const packId = crypto.randomUUID()
    const pack = await database.createPack({
      id: packId,
      name: finalName,
      description: packData.description ?? null,
      author: packData.author ?? null,
      isDefault: false,
    })

    for (const template of packData.templates) {
      // The imported file *is* this pack's baseline; edits the user makes afterwards are
      // what must be protected from a later refresh.
      await database.setPackTemplateContent(pack.id, template.templateId, template.content, true)
    }

    for (let i = 0; i < packData.variables.length; i++) {
      const variable = packData.variables[i]
      await database.createPackVariable(pack.id, {
        variableName: variable.variableName,
        displayName: variable.displayName,
        variableType: variable.variableType,
        isRequired: variable.isRequired,
        defaultValue: variable.defaultValue,
        enumOptions: variable.enumOptions,
        description: variable.description,
        sortOrder: variable.sortOrder ?? i,
      })
    }

    return pack.id
  }
}

export const importExportService = new ImportExportService()
