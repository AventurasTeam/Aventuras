import { open } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import { getVersion } from '@tauri-apps/api/app'
import { resolveSaveTarget } from '$lib/services/exportTarget'
import { packService } from './pack-service'
import { database } from '$lib/services/database'
import { validatePackImport, type PackExport } from './validation'
import { templateEngine } from '$lib/services/templates/engine'
import { hashContent } from './hash'
import { packUpdateSummary, type PackUpdateSummary } from './update-summary'
import type { PresetPack } from './types'
import { PACK_FILE } from './directory/layout'
import { pickDirectory, readTree, writeTree } from './directory/io'
import { validateTree, type DirectoryValidationResult } from './directory/parse'
import { parsePackFile } from './directory/serialize'
import {
  buildShippedBaselineTree,
  buildTree,
  planPrune,
  shippedTemplateRows,
  type Tree,
} from './directory/tree'
import type { StatusSource } from './directory/reference'

interface TemplateError {
  templateId: string
  /** Where it was found, when the source was a directory rather than a single file. */
  path?: string
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

/** An export worked out but not yet written, so the user can be asked about an unfamiliar folder. */
export interface DirectoryExportPlan {
  root: string
  tree: Tree
  /** Template and reference files of a previous export that this one no longer writes. */
  prunePaths: string[]
  /** The folder carries a `pack.yaml` this version can parse, so it is a tree we own. */
  isKnownExport: boolean
  /**
   * Ask before writing. True when the folder holds files we did not put there — one sharing a
   * name with a file being written is still overwritten — and whenever anything would be
   * deleted, because a `.md` a user kept beside the prompts is indistinguishable from a
   * template this export has dropped.
   */
  needsConfirmation: boolean
}

/** A directory read and validated, ready for the same import paths a `.prompt.json` takes. */
export interface DirectoryImportCandidate {
  root: string
  validation: DirectoryValidationResult
}

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

  /** Where an existing tree's files sit, and which of them this export would leave behind. */
  private async planWrite(root: string, tree: Tree): Promise<DirectoryExportPlan> {
    let existingPaths: string[] = []
    let packFileText: string | undefined
    try {
      const existing = await readTree(root)
      existingPaths = existing.allPaths
      packFileText = existing.contents.get(PACK_FILE)
    } catch (e) {
      // A folder that cannot be read is not one this export owns: nothing is pruned from it,
      // and the confirmation stands in for the certainty we could not get.
      console.error('[ImportExportService] Failed to read the chosen folder:', e)
      return { root, tree, prunePaths: [], isKnownExport: false, needsConfirmation: true }
    }

    // Pruning deletes files, so the folder has to prove it is one of ours. The name
    // `pack.yaml` alone does not: other tools use it too, and treating a stranger's folder
    // as a previous export would delete the Markdown nested inside it.
    const isKnownExport = packFileText !== undefined && parsePackFile(packFileText).ok
    const prunePaths = isKnownExport ? planPrune(existingPaths, tree) : []

    return {
      root,
      tree,
      prunePaths,
      isKnownExport,
      needsConfirmation: (!isKnownExport && existingPaths.length > 0) || prunePaths.length > 0,
    }
  }

  /** Plan an export of a pack as it is stored. `null` if the user cancelled the folder pick. */
  async planPackDirectoryExport(packId: string): Promise<DirectoryExportPlan | null> {
    const fullPack = await packService.getFullPack(packId)
    if (!fullPack) return null

    const root = await pickDirectory('Export prompt pack to folder')
    if (!root) return null

    const status: StatusSource = fullPack.pack.isDefault
      ? { kind: 'default-pack', rows: fullPack.templates, shippedHashes: await shippedHashes() }
      : { kind: 'custom-pack', rows: fullPack.templates }

    const tree = buildTree({
      source: 'pack',
      appVersion: await getVersion(),
      name: fullPack.pack.name,
      description: fullPack.pack.description ?? undefined,
      author: fullPack.pack.author ?? undefined,
      templates: fullPack.templates.map((t) => ({ templateId: t.templateId, content: t.content })),
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
      status,
    })

    return this.planWrite(root, tree)
  }

  /** Plan an export of the prompt text the app ships, which no pack can influence. */
  async planShippedBaselineExport(): Promise<DirectoryExportPlan | null> {
    const root = await pickDirectory('Export shipped prompts to folder')
    if (!root) return null

    return this.planWrite(root, buildShippedBaselineTree(await getVersion()))
  }

  async applyDirectoryExport(plan: DirectoryExportPlan): Promise<void> {
    await writeTree(plan.root, plan.tree, plan.prunePaths)
  }

  /** Pick a folder and validate it in full. `null` if the user cancelled. */
  async pickAndValidateDirectory(): Promise<DirectoryImportCandidate | null> {
    const root = await pickDirectory('Import prompt pack from folder')
    if (!root) return null

    try {
      const { contents } = await readTree(root)
      return { root, validation: validateTree(contents) }
    } catch (e) {
      console.error('[ImportExportService] Failed to read the chosen folder:', e)
      return {
        root,
        validation: {
          valid: false,
          structuralErrors: [`Could not read that folder: ${(e as Error).message}`],
          templateErrors: [],
        },
      }
    }
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

/** The hash of the text the app ships, per stored row id, for the status report. */
async function shippedHashes(): Promise<Map<string, string>> {
  const entries = await Promise.all(
    shippedTemplateRows().map(
      async (row) => [row.templateId, await hashContent(row.content)] as [string, string],
    ),
  )
  return new Map(entries)
}

export const importExportService = new ImportExportService()
