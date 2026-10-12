import { database } from '#lib/services/database.ts'
import type { VaultTag, VaultType } from '#lib/types/index.ts'

class TagStore {
  tags = $state<VaultTag[]>([])
  isLoaded = $state(false)

  // Derived views
  get characterTags() {
    return this.tags.filter((t) => t.type === 'character')
  }
  get lorebookTags() {
    return this.tags.filter((t) => t.type === 'lorebook')
  }
  get scenarioTags() {
    return this.tags.filter((t) => t.type === 'scenario')
  }

  async load() {
    if (this.isLoaded) return

    // Ensure migration runs once
    await database.ensureTagsMigrated()

    // Fetch all tags
    this.tags = await database.getVaultTags()
    this.isLoaded = true
  }

  getTagsForType(type: VaultType) {
    return this.tags.filter((t) => t.type === type)
  }

  getColor(name: string, type: VaultType): string {
    return this.tags.find((t) => t.name === name && t.type === type)?.color ?? 'surface-500'
  }

  async add(name: string, type: VaultType): Promise<VaultTag> {
    const colors = [
      'red-500',
      'orange-500',
      'amber-500',
      'yellow-500',
      'lime-500',
      'green-500',
      'emerald-500',
      'teal-500',
      'cyan-500',
      'sky-500',
      'blue-500',
      'indigo-500',
      'violet-500',
      'purple-500',
      'fuchsia-500',
      'pink-500',
      'rose-500',
    ]
    const color = colors[Math.floor(Math.random() * colors.length)]

    const tag: VaultTag = {
      id: crypto.randomUUID(),
      name,
      type,
      color,
      createdAt: Date.now(),
    }

    await database.addVaultTag(tag)
    this.tags.push(tag)
    return tag
  }

  async update(id: string, updates: Partial<VaultTag>) {
    await database.updateVaultTag(id, updates)
    const index = this.tags.findIndex((t) => t.id === id)
    if (index !== -1) {
      this.tags[index] = { ...this.tags[index], ...updates }
    }
  }

  async delete(id: string) {
    await database.deleteVaultTag(id)
    this.tags = this.tags.filter((t) => t.id !== id)
  }
}

export const tagStore = new TagStore()
