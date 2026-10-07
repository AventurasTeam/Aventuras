import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, within } from 'storybook/test'

import { t } from '@/lib/i18n'
import type { RailStripModel, StripCategory } from '@/lib/reader-rail'

import { railDataFixture } from './rail-story-fixtures'
import { RAIL_STRIP_WIDTH_PX, RailStrip } from './rail-strip'

const MIXED: RailStripModel = {
  counted: [
    { category: 'character', count: 3, tint: 'fresh' },
    { category: 'item', count: 1, tint: 'fading' },
  ],
  quickAccess: [
    { category: 'location', tint: 'fresh' },
    { category: 'faction', tint: undefined },
  ],
}

const UNTINTED: RailStripModel = {
  counted: [
    { category: 'character', count: 2, tint: undefined },
    { category: 'item', count: 1, tint: undefined },
  ],
  quickAccess: [
    { category: 'location', tint: undefined },
    { category: 'faction', tint: undefined },
  ],
}

const COUNTS: RailStripModel = {
  counted: [
    { category: 'character', count: 0, tint: undefined },
    { category: 'item', count: 12, tint: undefined },
  ],
  quickAccess: [
    { category: 'location', tint: 'fading' },
    { category: 'faction', tint: 'fresh' },
  ],
}

const STRIP_CATEGORIES: readonly StripCategory[] = ['character', 'item', 'location', 'faction']

// null: no tint layer at all. Opacity is the strength: '1' fresh, '0.5' fading.
function tintOpacity(category: StripCategory): string | null {
  const layer = screen.queryByTestId(`rail-strip-tint-${category}`)
  return layer == null ? null : getComputedStyle(layer).opacity
}

// The layers are pointer-events: none, so the hit test switches the probed ones on to see them.
function topmostAt(
  testIDs: string[],
  point: (glyph: DOMRect) => [number, number],
): { hit: Element | null; glyph: SVGElement } {
  const layers = testIDs.map((id) => screen.getByTestId(id))
  const glyph = (layers[0].parentElement as HTMLElement).querySelector('svg') as SVGElement
  const [x, y] = point(glyph.getBoundingClientRect())
  for (const layer of layers) layer.style.pointerEvents = 'auto'
  const hit = document.elementFromPoint(x, y)
  for (const layer of layers) layer.style.pointerEvents = 'none'
  return { hit, glyph }
}

const overGlyph = (r: DOMRect): [number, number] => [r.left + r.width / 2, r.top + r.height / 2]
const besideGlyph = (r: DOMRect): [number, number] => [r.left - 2, r.top + r.height / 2]

/** Over the glyph the svg itself must be hit, so no probed layer washes it out. */
function glyphIsTopmost(...testIDs: string[]): boolean {
  const { hit, glyph } = topmostAt(testIDs, overGlyph)
  return hit != null && glyph.contains(hit)
}

/** Beside the glyph the topmost layer is the first id: hover above tint, tint above the strip. */
function topLayerBesideGlyph(...testIDs: string[]): Element | null {
  return topmostAt(testIDs, besideGlyph).hit
}

const meta: Meta<typeof RailStrip> = {
  title: 'Compounds/Reader/RailStrip',
  component: RailStrip,
  parameters: { layout: 'centered' },
  args: { model: MIXED, onExpand: fn(), onExpandTo: fn() },
  decorators: [
    (Story) => (
      <View style={{ width: RAIL_STRIP_WIDTH_PX, height: 420 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof RailStrip>

export const FromFixture: Story = {
  args: { model: railDataFixture().strip },
  play: async () => {
    await expect(screen.getByTestId('rail-strip')).toBeVisible()
    await expect(screen.getByRole('button', { name: t('reader:rail.expand') })).toBeVisible()
  },
}

/** Fresh tints full, fading tints half, an untouched kind carries no tint at all. */
export const TintStates: Story = {
  play: async () => {
    await expect(tintOpacity('character')).toBe('1')
    await expect(tintOpacity('item')).toBe('0.5')
    await expect(tintOpacity('location')).toBe('1')
    await expect(tintOpacity('faction')).toBeNull()

    // Full contrast: the glyph draws over the tint, never under it.
    for (const category of ['character', 'item', 'location'] as const) {
      await expect(glyphIsTopmost(`rail-strip-tint-${category}`)).toBe(true)
    }
    // Beside the glyph the tint shows: it sits above the strip's own background.
    await expect(topLayerBesideGlyph('rail-strip-tint-character')).toBe(
      screen.getByTestId('rail-strip-tint-character'),
    )
  },
}

export const Untinted: Story = {
  args: { model: UNTINTED },
  play: async () => {
    for (const category of STRIP_CATEGORIES) {
      await expect(tintOpacity(category)).toBeNull()
    }
  },
}

/** `9+` above nine and the true count in the name; zero renders muted, a live count does not. */
export const CountsAndCap: Story = {
  args: { model: COUNTS },
  play: async () => {
    const itemsName = t('reader:rail.strip.item', { count: 12 })
    const items = screen.getByRole('button', { name: itemsName })
    await expect(items).toHaveTextContent('9+')
    await expect(screen.getByTitle(itemsName)).toContainElement(items)

    const characters = screen.getByRole('button', {
      name: t('reader:rail.strip.character', { count: 0 }),
    })
    await expect(characters).toHaveTextContent('0')
    await expect(within(characters).getByText('0')).toHaveClass('text-fg-muted')
    await expect(within(items).getByText('9+')).not.toHaveClass('text-fg-muted')

    await expect(tintOpacity('location')).toBe('0.5')
    await expect(tintOpacity('faction')).toBe('1')
  },
}

/** A cell expands and switches; the chevron and the empty region only expand. */
export const HitZones: Story = {
  play: async ({ args }) => {
    await userEvent.click(
      screen.getByRole('button', { name: t('reader:rail.strip.item', { count: 1 }) }),
    )
    await expect(args.onExpandTo).toHaveBeenCalledWith('item')
    await expect(args.onExpand).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: t('reader:rail.strip.faction') }))
    await expect(args.onExpandTo).toHaveBeenLastCalledWith('faction')

    await userEvent.click(screen.getByRole('button', { name: t('reader:rail.expand') }))
    await expect(args.onExpand).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByTestId('rail-strip-empty'))
    await expect(args.onExpand).toHaveBeenCalledTimes(2)
    await expect(args.onExpandTo).toHaveBeenCalledTimes(2)

    // The empty region is pointer-only: assistive tech meets one expand control, and Tab skips it.
    await expect(screen.getByTestId('rail-strip-empty')).toHaveAttribute('tabindex', '-1')
    await expect(screen.getAllByRole('button', { name: t('reader:rail.expand') })).toHaveLength(1)
  },
}

/** Hover lights its own zone only, and leaves the tint under it untouched. */
export const HoverPerZone: Story = {
  play: async () => {
    const hoverBg = (category: StripCategory) =>
      getComputedStyle(screen.getByTestId(`rail-strip-hover-${category}`)).backgroundColor
    const tintBg = () =>
      getComputedStyle(screen.getByTestId('rail-strip-tint-character')).backgroundColor
    const idle = hoverBg('character')
    const tintBefore = tintBg()

    // Real pointer hover exists only under Vitest; the module throws on import anywhere else.
    const browser = await import('vitest/browser').catch(() => null)
    if (browser == null) return

    await browser.userEvent.hover(
      screen.getByRole('button', { name: t('reader:rail.strip.character', { count: 3 }) }),
    )
    await expect(hoverBg('character')).not.toBe(idle)
    await expect(hoverBg('item')).toBe(idle)
    await expect(tintBg()).toBe(tintBefore)
    // Over the tint, never instead of it, and under the glyph like the tint.
    await expect(
      topLayerBesideGlyph('rail-strip-hover-character', 'rail-strip-tint-character'),
    ).toBe(screen.getByTestId('rail-strip-hover-character'))
    await expect(glyphIsTopmost('rail-strip-hover-character', 'rail-strip-tint-character')).toBe(
      true,
    )
  },
}
