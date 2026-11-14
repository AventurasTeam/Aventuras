import { t } from '@/lib/i18n'

export const TOOL_LABEL_KEYS = {
  create_lore: 'chapters:review.tool.create_lore',
  flag_duplicate: 'chapters:review.tool.flag_duplicate',
  mark_common_knowledge: 'chapters:review.tool.mark_common_knowledge',
  merge_happenings: 'chapters:review.tool.merge_happenings',
  merge_threads: 'chapters:review.tool.merge_threads',
  retire_entity: 'chapters:review.tool.retire_entity',
  set_keywords: 'chapters:review.tool.set_keywords',
  set_pin: 'chapters:review.tool.set_pin',
  update_character: 'chapters:review.tool.update_character',
  update_faction: 'chapters:review.tool.update_faction',
  update_item: 'chapters:review.tool.update_item',
  update_lore: 'chapters:review.tool.update_lore',
  update_place: 'chapters:review.tool.update_place',
  update_thread: 'chapters:review.tool.update_thread',
} as const

function isLabelledTool(tool: string): tool is keyof typeof TOOL_LABEL_KEYS {
  return Object.hasOwn(TOOL_LABEL_KEYS, tool)
}

/** What a refusal that resolved no row names: what the tool writes, never its id. */
export function toolLabel(tool: string): string {
  return isLabelledTool(tool) ? t(TOOL_LABEL_KEYS[tool]) : t('history:unknownTarget')
}
