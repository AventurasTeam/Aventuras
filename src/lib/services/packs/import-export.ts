import { save, open } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import { packService } from './pack-service'
import { database } from '$lib/services/database'
import { validatePackImport, type PackExport } from './validation'
import { templateEngine } from '$lib/services/templates/engine'
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

export type ConflictStrategy = 'replace' | 'rename' | 'cancel'

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

    const filePath = await save({
      defaultPath: suggestedName,
      filters: [{ name: 'Prompt Pack', extensions: ['prompt.json'] }],
    })

    if (!filePath) return false

    await writeTextFile(filePath, JSON.stringify(exportData, null, 2))
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

  async applyImport(
    packData: PackExport,
    strategy: ConflictStrategy,
    existingPack?: PresetPack,
  ): Promise<string | null> {
    if (strategy === 'cancel') return null

    if (strategy === 'replace' && existingPack) {
      if (existingPack.isDefault) {
        throw new Error('Cannot replace the default pack')
      }
      const usageCount = await database.getPackUsageCount(existingPack.id)
      if (usageCount > 0) {
        throw new Error(
          `Cannot replace pack "${existingPack.name}" — it is used by ${usageCount} ${usageCount === 1 ? 'story' : 'stories'}. Reassign them first.`,
        )
      }
      await database.deletePack(existingPack.id)
    }

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
      await database.setPackTemplateContent(pack.id, template.templateId, template.content)
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
