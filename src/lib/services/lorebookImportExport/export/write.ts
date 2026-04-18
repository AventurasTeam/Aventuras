/**
 * File writing and export orchestration
 */

import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import type { LorebookExportOptions, ExportFormat } from '../types'
import { exportToAventura, exportToSillyTavern, exportToText } from './formats'

function getFileExtension(format: ExportFormat): string {
  switch (format) {
    case 'aventura':
      return '.json'
    case 'sillytavern':
      return '.json'
    case 'text':
      return '.txt'
  }
}

async function saveFile(content: string, defaultPath: string): Promise<boolean> {
  try {
    const filePath = await save({
      defaultPath,
      filters: [
        { name: 'Aventura Lorebook', extensions: ['json'] },
        { name: 'Text', extensions: ['txt'] },
      ],
    })

    if (!filePath) return false

    await writeTextFile(filePath, content)
    return true
  } catch (error) {
    console.error('[LorebookExporter] Failed to save file:', error)
    throw error
  }
}

export async function exportLorebook(options: LorebookExportOptions): Promise<boolean> {
  const { format, entries, filename } = options

  if (entries.length === 0) {
    throw new Error('No entries to export')
  }

  let content: string
  const baseFilename = filename ?? `lorebook-${new Date().toISOString().split('T')[0]}`
  const extension = getFileExtension(format)

  switch (format) {
    case 'aventura':
      content = exportToAventura(entries)
      break
    case 'sillytavern':
      content = exportToSillyTavern(entries, baseFilename)
      break
    case 'text':
      content = exportToText(entries)
      break
  }

  return await saveFile(content, baseFilename + extension)
}
