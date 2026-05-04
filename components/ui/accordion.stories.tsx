import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Accordion> = {
  title: 'Patterns/Accordion',
  component: Accordion,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Accordion>

export const Strip: Story = {
  render: () => (
    <View style={{ width: 480 }}>
      <Accordion type="multiple" defaultValue={['active']}>
        <AccordionItem value="active">
          <AccordionTrigger>
            <Text>Active (4)</Text>
          </AccordionTrigger>
          <AccordionContent>
            <Text>Active entity rows go here.</Text>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="staged">
          <AccordionTrigger>
            <Text>Staged (2)</Text>
          </AccordionTrigger>
          <AccordionContent>
            <Text>Staged entity rows go here.</Text>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="retired">
          <AccordionTrigger>
            <Text>Retired (1)</Text>
          </AccordionTrigger>
          <AccordionContent>
            <Text>Retired entity rows go here.</Text>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </View>
  ),
}

export const SingleOpen: Story = {
  render: () => (
    <View style={{ width: 480 }}>
      <Accordion type="single" collapsible defaultValue="q1">
        <AccordionItem value="q1">
          <AccordionTrigger>
            <Text>What is a story branch?</Text>
          </AccordionTrigger>
          <AccordionContent>
            <Text>A divergent timeline; rolls back to a fork point and grows independently.</Text>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="q2">
          <AccordionTrigger>
            <Text>What is the entity classifier?</Text>
          </AccordionTrigger>
          <AccordionContent>
            <Text>An LLM pass that extracts entities + state from each entry.</Text>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </View>
  ),
}

// Per docs/ui/patterns/accordion.md → Card vs strip — composition.
// Consumers wanting card chrome add it via className on
// AccordionItem (drop border-b, add border + radius + bg-region).
export const CardComposition: Story = {
  render: () => (
    <View style={{ width: 480 }} className="gap-3.5">
      <Accordion type="multiple" defaultValue={['narrative']}>
        <AccordionItem
          value="narrative"
          className="bg-bg-region rounded-md border border-b-0 border-border px-4"
        >
          <AccordionTrigger>
            <View>
              <Text className="font-semibold">Narrative</Text>
              <Text size="xs" variant="muted">
                Default story-side profile
              </Text>
            </View>
          </AccordionTrigger>
          <AccordionContent>
            <Text>Configuration body for the Narrative profile…</Text>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem
          value="fast"
          className="bg-bg-region mt-3 rounded-md border border-b-0 border-border px-4"
        >
          <AccordionTrigger>
            <View>
              <Text className="font-semibold">Fast tasks</Text>
              <Text size="xs" variant="muted">
                Used for classification + lore extraction
              </Text>
            </View>
          </AccordionTrigger>
          <AccordionContent>
            <Text>Configuration body for the Fast tasks profile…</Text>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </View>
  ),
}

export const DisabledItem: Story = {
  render: () => (
    <View style={{ width: 480 }}>
      <Accordion type="multiple">
        <AccordionItem value="a">
          <AccordionTrigger>
            <Text>Available</Text>
          </AccordionTrigger>
          <AccordionContent>
            <Text>Body content.</Text>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="b">
          <AccordionTrigger disabled>
            <Text>Disabled</Text>
          </AccordionTrigger>
          <AccordionContent>
            <Text>Won&apos;t open.</Text>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </View>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="rounded-md bg-bg-base p-3"
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm" className="mb-2">
            {t.name}
          </Text>
          <Accordion type="multiple" defaultValue={['x']}>
            <AccordionItem value="x">
              <AccordionTrigger>
                <Text>Open by default</Text>
              </AccordionTrigger>
              <AccordionContent>
                <Text>Body content visible.</Text>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="y">
              <AccordionTrigger>
                <Text>Closed</Text>
              </AccordionTrigger>
              <AccordionContent>
                <Text>Hidden until opened.</Text>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </View>
      ))}
    </View>
  ),
}
