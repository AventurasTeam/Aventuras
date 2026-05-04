import { ScrollView, View } from 'react-native'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

export default function AccordionDevRoute() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <View>
          <Heading level={3}>Strip — multi-open default</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            Browse rail status grouping shape. Multiple groups can be expanded simultaneously.
          </Text>
          <View className="mt-3">
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
        </View>

        <View>
          <Heading level={3}>Single-open (FAQ)</Heading>
          <View className="mt-3">
            <Accordion type="single" collapsible defaultValue="q1">
              <AccordionItem value="q1">
                <AccordionTrigger>
                  <Text>What is a story branch?</Text>
                </AccordionTrigger>
                <AccordionContent>
                  <Text>
                    A divergent timeline; rolls back to a fork point and grows independently.
                  </Text>
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
        </View>

        <View>
          <Heading level={3}>Card composition</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            App Settings profile-list shape. Card chrome via consumer className.
          </Text>
          <View className="mt-3">
            <Accordion type="multiple" defaultValue={['narrative']}>
              <AccordionItem
                value="narrative"
                className="bg-bg-region rounded-md border border-border px-4"
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
                className="bg-bg-region mt-3 rounded-md border border-border px-4"
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
        </View>
      </View>
    </ScrollView>
  )
}
