import { View } from 'react-native'
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
] as const

export default function DevIndex() {
  return (
    <View className="flex-1 gap-2 bg-bg-base p-4">
      <Text size="lg">Dev surfaces</Text>
      {ROUTES.map((r) => (
        <Link key={r.href} href={r.href} asChild>
          <Button variant="secondary">
            <Text>{r.label}</Text>
          </Button>
        </Link>
      ))}
    </View>
  )
}
