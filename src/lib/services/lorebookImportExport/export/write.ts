/**
 * File writing and export orchestration
 */

import { writeTextFile } from '@tauri-apps/plugin-fs'
import { resolveSaveTarget } from '$lib/services/exportTarget'
import type { LorebookExportOptions } from '../types'
import { exportToAventura, exportToSillyTavern, exportToText } from './formats'
import { getFormatInfo } from './metadata'

async function saveFile(content: string, defaultPath: string): Promise<boolean> {
  try {
    const target = await resolveSaveTarget(defaultPath, [
      { name: 'Aventura Lorebook', extensions: ['json'] },
      { name: 'Text', extensions: ['txt'] },
    ])
    if (!target) return false

    await writeTextFile(target.destPath, content)
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
  const extension = getFormatInfo(format).extension

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
