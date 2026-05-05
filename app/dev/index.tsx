import { ScrollView } from 'react-native'
import { Link } from 'expo-router'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

const ROUTES = [
  { href: '/dev/foundations', label: 'Foundations explorer' },
  { href: '/dev/button', label: 'Button' },
  { href: '/dev/text', label: 'Text' },
  { href: '/dev/heading', label: 'Heading' },
  { href: '/dev/popover', label: 'Popover' },
  { href: '/dev/sheet', label: 'Sheet' },
  { href: '/dev/select', label: 'Select' },
  { href: '/dev/input', label: 'Input + Textarea' },
  { href: '/dev/choice', label: 'Switch + Checkbox' },
  { href: '/dev/visual', label: 'Icon + Avatar' },
  { href: '/dev/icon-action', label: 'IconAction' },
  { href: '/dev/empty-state', label: 'EmptyState' },
  { href: '/dev/loading', label: 'Spinner + Skeleton' },
  { href: '/dev/tabs', label: 'Tabs' },
  { href: '/dev/chip-tag', label: 'Chip + Tag' },
  { href: '/dev/accordion', label: 'Accordion' },
  { href: '/dev/alert-dialog', label: 'AlertDialog' },
  { href: '/dev/toast', label: 'Toast' },
] as const

export default function DevIndex() {
  return (
    <ScrollView className="flex-1 bg-bg-base" contentContainerClassName="gap-2 p-4">
      <Text size="lg">Dev surfaces</Text>
      {ROUTES.map((r) => (
        <Link key={r.href} href={r.href} asChild>
          <Button variant="secondary">
            <Text>{r.label}</Text>
          </Button>
        </Link>
      ))}
    </ScrollView>
  )
}
