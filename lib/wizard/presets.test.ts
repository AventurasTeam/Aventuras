import { describe, expect, it } from 'vitest'

import { GENRE_PRESETS, TONE_PRESETS, type WizardPreset } from './presets'

function assertCatalogShape(catalog: readonly WizardPreset[], label: string) {
  expect(catalog.length, `${label} ships at least 10 entries`).toBeGreaterThanOrEqual(10)

  const ids = catalog.map((p) => p.id)
  expect(new Set(ids).size, `${label} ids are unique`).toBe(ids.length)

  const names = catalog.map((p) => p.displayName.toLowerCase())
  expect(new Set(names).size, `${label} display names are unique`).toBe(names.length)

  for (const preset of catalog) {
    expect(preset.id, `${label} id is kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(preset.displayName.trim().length, `${preset.id} has a display name`).toBeGreaterThan(0)
    expect(preset.tagline.trim().length, `${preset.id} has a tagline`).toBeGreaterThan(0)
    expect(preset.promptBody.trim().length, `${preset.id} body is substantial`).toBeGreaterThan(200)
  }
}

describe('wizard preset catalog', () => {
  it('genre catalog is well-formed', () => {
    assertCatalogShape(GENRE_PRESETS, 'GENRE_PRESETS')
  })

  it('tone catalog is well-formed', () => {
    assertCatalogShape(TONE_PRESETS, 'TONE_PRESETS')
  })

  it('genre and tone ids do not collide, so a single picker key is unambiguous', () => {
    const overlap = GENRE_PRESETS.map((p) => p.id).filter((id) =>
      TONE_PRESETS.some((t) => t.id === id),
    )
    expect(overlap).toEqual([])
  })
})
