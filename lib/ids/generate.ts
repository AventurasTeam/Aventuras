function uuidv4(): string {
  return crypto.randomUUID()
}

export function generateId(prefix: string): string {
  return `${prefix}_${uuidv4()}`
}
