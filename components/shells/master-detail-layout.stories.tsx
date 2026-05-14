import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes/registry'

import { MasterDetailLayout } from './master-detail-layout'

// ──────────────────────────────────────────────────────────────────
// Placeholders. We deliberately don't pull EntityListPane /
// DetailPane in as direct dependencies — the shell never reaches
// into the slot ReactNodes, so cheap placeholder Views demonstrate
// the layout contract just as well and keep the stories focused on
// MasterDetailLayout's own positioning rules.
// ──────────────────────────────────────────────────────────────────

function ListPanePlaceholder({ label }: { label: string }) {
  return (
    <View className="flex-1 gap-2 bg-bg-sunken p-3">
      <Text size="sm" variant="muted">
        {label}
      </Text>
      {Array.from({ length: 5 }, (_, i) => (
        <View key={i} className="rounded-sm border border-border bg-bg-base px-3 py-2">
          <Text size="sm">Row {i + 1}</Text>
        </View>
      ))}
    </View>
  )
}

function DetailPanePlaceholder({ label }: { label: string }) {
  return (
    <View className="flex-1 items-start justify-start gap-2 bg-bg-base p-4">
      <Text size="sm" variant="muted">
        {label}
      </Text>
      <View className="w-full rounded-sm bg-bg-sunken p-3">
        <Text size="sm" variant="muted">
          (Per-kind body — forms, tabs, lists — is consumer-rendered.)
        </Text>
      </View>
    </View>
  )
}

// Mimics the BreadcrumbTitle shape consumers will eventually pass —
// kind segment plus selected row name. The shell only positions the
// slot, so a flat Text row is enough to demonstrate placement.
function SubHeaderPlaceholder({ text }: { text: string }) {
  return (
    <Text size="sm" variant="secondary">
      {text}
    </Text>
  )
}

const meta: Meta<typeof MasterDetailLayout> = {
  title: 'Shells/MasterDetailLayout',
  component: MasterDetailLayout,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof MasterDetailLayout>

// ──────────────────────────────────────────────────────────────────
// Story 1 — Tablet / desktop, 2-pane side-by-side. Default 340 px
// list, flex-1 detail with vertical divider.
// ──────────────────────────────────────────────────────────────────

export const WorldTabletDesktop: Story = {
  render: () => (
    <View style={{ height: 600 }}>
      <MasterDetailLayout
        isRowSelected
        subHeader={<SubHeaderPlaceholder text="Characters / Kael Vex" />}
        listPane={<ListPanePlaceholder label="List pane (340 px)" />}
        detailPane={<DetailPanePlaceholder label="Detail pane content" />}
      />
    </View>
  ),
}

// ──────────────────────────────────────────────────────────────────
// Story 2 — Phone list-first state. List pane fills the surface;
// detail pane is mounted but display:none.
// ──────────────────────────────────────────────────────────────────

export const PhoneListFirst: Story = {
  render: () => (
    <View style={{ width: 360, height: 600 }} className="gap-2">
      <Text variant="muted" size="sm" className="px-3 pt-2">
        360 px wrapper is layout-only — `useTier()` reads window dimensions, so the phone list-first
        collapse only renders when the Storybook window itself is &lt; 640 px wide. Resize the
        browser to verify.
      </Text>
      <MasterDetailLayout
        isRowSelected={false}
        subHeader={<SubHeaderPlaceholder text="Characters" />}
        listPane={<ListPanePlaceholder label="List pane — phone list-first" />}
        detailPane={<DetailPanePlaceholder label="Detail pane (mounted, hidden)" />}
      />
    </View>
  ),
}

// ──────────────────────────────────────────────────────────────────
// Story 3 — Phone detail-route state. Detail pane fills the
// surface; list pane is mounted but display:none. Same caveat:
// requires < 640 px window width to actually render in this state.
// ──────────────────────────────────────────────────────────────────

export const PhoneDetailRoute: Story = {
  render: () => (
    <View style={{ width: 360, height: 600 }} className="gap-2">
      <Text variant="muted" size="sm" className="px-3 pt-2">
        Same window-width caveat as PhoneListFirst — `useTier()` reads the window, not the wrapper.
        Resize the Storybook window &lt; 640 px to see the detail-route state.
      </Text>
      <MasterDetailLayout
        isRowSelected
        subHeader={<SubHeaderPlaceholder text="Characters / Kael Vex" />}
        listPane={<ListPanePlaceholder label="List pane (mounted, hidden)" />}
        detailPane={<DetailPanePlaceholder label="Detail pane — phone detail-route" />}
      />
    </View>
  ),
}

// ──────────────────────────────────────────────────────────────────
// Story 4 — Tablet / desktop with no subHeader. Demonstrates the
// optional slot — panes butt up directly to the parent's body
// region with no breadcrumb strip in between.
// ──────────────────────────────────────────────────────────────────

export const WithoutSubHeader: Story = {
  render: () => (
    <View style={{ height: 600 }}>
      <MasterDetailLayout
        isRowSelected
        listPane={<ListPanePlaceholder label="List pane — no subHeader" />}
        detailPane={<DetailPanePlaceholder label="Detail pane — no subHeader" />}
      />
    </View>
  ),
}

// ──────────────────────────────────────────────────────────────────
// Story 5 — Custom list-pane width (280 px). Demonstrates the
// listPaneWidth override for surfaces with a different width
// constraint than the default 340 px.
// ──────────────────────────────────────────────────────────────────

export const CustomListWidth: Story = {
  render: () => (
    <View style={{ height: 600 }}>
      <MasterDetailLayout
        isRowSelected
        listPaneWidth={280}
        subHeader={<SubHeaderPlaceholder text="Threads / Crown's bargain" />}
        listPane={<ListPanePlaceholder label="List pane (280 px override)" />}
        detailPane={<DetailPanePlaceholder label="Detail pane content" />}
      />
    </View>
  ),
}

// ──────────────────────────────────────────────────────────────────
// Story 6 — Theme matrix. Iterates over the registry so each theme
// renders the 2-pane layout with its tokens. Mirrors the pattern in
// screen-shell.stories.tsx → ThemeMatrix.
// ──────────────────────────────────────────────────────────────────

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4 p-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="gap-1"
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <View className="h-64 overflow-hidden rounded-md border border-border">
            <MasterDetailLayout
              isRowSelected
              subHeader={<SubHeaderPlaceholder text="Characters / Kael Vex" />}
              listPane={<ListPanePlaceholder label="List pane" />}
              detailPane={<DetailPanePlaceholder label="Detail pane content" />}
            />
          </View>
        </View>
      ))}
    </View>
  ),
}
