import { createLogger } from '$lib/log'

const log = createLogger('characterCardImport')

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function isPngFile(data: ArrayBuffer | Uint8Array): boolean {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
  if (bytes.length < 8) return false

  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false
  }
  return true
}

export function readFromPng(data: ArrayBuffer | Uint8Array): string | null {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data

  if (!isPngFile(bytes)) {
    log('Not a valid PNG file')
    return null
  }

  let offset = 8

  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) break
    const length =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]
    offset += 4

    if (offset + 4 > bytes.length) break
    const type = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    )
    offset += 4

    if (type === 'tEXt') {
      if (offset + length > bytes.length) break
      const chunkData = bytes.slice(offset, offset + length)

      let nullIndex = -1
      for (let i = 0; i < chunkData.length; i++) {
        if (chunkData[i] === 0) {
          nullIndex = i
          break
        }
      }

      if (nullIndex > 0) {
        const keyword = new TextDecoder('latin1').decode(chunkData.slice(0, nullIndex))

        if (keyword.toLowerCase() === 'chara') {
          const textData = chunkData.slice(nullIndex + 1)
          const base64String = new TextDecoder('latin1').decode(textData)

          try {
            const binaryString = atob(base64String)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i)
            }
            const jsonString = new TextDecoder('utf-8').decode(bytes)
            log('Found character data in PNG tEXt chunk')
            return jsonString
          } catch (e) {
            log('Failed to decode base64 character data:', e)
            return null
          }
        }
      }
    }

    offset += length + 4

    if (type === 'IEND') break
  }

  log('No character data found in PNG')
  return null
}
