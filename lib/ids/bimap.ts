import { PLACEHOLDER_PREFIX_BY_KIND, type SubstitutablePrefix } from './prefixes'

export class IdBiMap {
  private uuidToPlaceholder = new Map<string, string>()
  private placeholderToUuid = new Map<string, string>()
  private counters: Record<string, number> = {}

  allocate(uuid: string): string {
    const existing = this.uuidToPlaceholder.get(uuid)
    if (existing) return existing
    const kindPrefix = uuid.split('_')[0] as SubstitutablePrefix
    const placeholderPrefix = PLACEHOLDER_PREFIX_BY_KIND[kindPrefix]
    const n = (this.counters[placeholderPrefix] ?? 0) + 1
    this.counters[placeholderPrefix] = n
    const placeholder = `${placeholderPrefix}${n}`
    this.uuidToPlaceholder.set(uuid, placeholder)
    this.placeholderToUuid.set(placeholder, uuid)
    return placeholder
  }

  getPlaceholderFor(uuid: string): string | undefined {
    return this.uuidToPlaceholder.get(uuid)
  }

  getUuidFor(placeholder: string): string | undefined {
    return this.placeholderToUuid.get(placeholder)
  }

  registerHandle(handle: string, uuid: string): void {
    this.placeholderToUuid.set(handle, uuid)
  }
}
