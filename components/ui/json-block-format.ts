export function formatJSON(data: unknown): string {
  try {
    const result = JSON.stringify(data, null, 2)
    return result ?? ''
  } catch {
    return String(data)
  }
}
