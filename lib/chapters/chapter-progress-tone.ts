export type ChapterProgressTone = 'success' | 'warning' | 'danger'

export function chapterProgressTone(percent: number): ChapterProgressTone {
  if (percent >= 90) return 'danger'
  if (percent >= 80) return 'warning'
  return 'success'
}
