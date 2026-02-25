/** SHA-256 hash with whitespace normalization for template modification detection. */
export async function hashContent(content: string): Promise<string> {
  const normalized = content.trim().replace(/\r\n/g, '\n')
  const data = new TextEncoder().encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
