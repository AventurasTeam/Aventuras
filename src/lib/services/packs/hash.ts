import { sha256Hex } from '#lib/utils/hash.ts'

/** SHA-256 hash with whitespace normalization for template modification detection. */
export async function hashContent(content: string): Promise<string> {
  const normalized = content.trim().replace(/\r\n/g, '\n')
  return sha256Hex(new TextEncoder().encode(normalized))
}

export async function packTemplateHashes(pack: {
  templates: { templateId: string; content: string }[]
}): Promise<Map<string, string>> {
  return new Map(
    await Promise.all(
      pack.templates.map(
        async (t) => [t.templateId, await hashContent(t.content)] as [string, string],
      ),
    ),
  )
}
