import { EmptyState } from '@/components/ui/empty-state'

export function PlaceholderTab({ title, body }: { title: string; body: string }) {
  return <EmptyState title={title} subtext={body} />
}
