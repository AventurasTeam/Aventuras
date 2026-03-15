import { createLogger } from '$lib/log'
import { readFromPng } from './pngDecoder'

const log = createLogger('characterCardImport')

export async function readFile(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith('.png')) {
    log('Reading PNG file:', file.name)
    const arrayBuffer = await file.arrayBuffer()
    const jsonString = readFromPng(arrayBuffer)

    if (!jsonString) {
      throw new Error(
        'No character data found in PNG file. The image may not be a valid SillyTavern character card.',
      )
    }

    return jsonString
  }

  log('Reading JSON file:', file.name)
  return await file.text()
}
