import type { Entity, Lore } from '@/lib/db'

export function makeEntity(
  overrides: Partial<Entity> & Pick<Entity, 'id' | 'kind' | 'name'>,
): Entity {
  return {
    branchId: 'br_1',
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    state: null,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

export function makeLore(overrides: Partial<Lore> & Pick<Lore, 'id' | 'title'>): Lore {
  return {
    branchId: 'br_1',
    body: null,
    category: null,
    tags: [],
    keywords: [],
    injectionMode: 'auto',
    priority: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}
