import { sha256Hex } from '#lib/utils/hash.ts'

/** SHA-256 hash with whitespace normalization for template modification detection. */
export async function hashContent(content: string): Promise<string> {
  const normalized = content.trim().replace(/\r\n/g, '\n')
  return sha256Hex(new TextEncoder().encode(normalized))
}
