/** Custom variable type for pack variables (extends VariableType with textarea). */
export type CustomVariableType = 'text' | 'textarea' | 'enum' | 'number' | 'boolean'

/** Enum option: separates display label from stored value. */
export interface EnumOption {
  /** Display text shown in UI */
  label: string
  /** Stored value used in templates */
  value: string
}

/** User-configurable variable used in pack templates. variableName for templates, displayName for UI. */
export interface CustomVariable {
  /** Unique identifier */
  id: string
  /** Pack this variable belongs to */
  packId: string
  /** Variable name for template usage (e.g., 'writing_style') */
  variableName: string
  /** Display name for UI (e.g., 'Writing Style') */
  displayName: string
  /** Optional description / help text (shown in wizard) */
  description?: string
  /** Variable data type */
  variableType: CustomVariableType
  /** Whether this variable must have a value */
  isRequired: boolean
  /** Author-defined display order within pack (lower = first) */
  sortOrder: number
  /** Default value (stored as string, parsed by type) */
  defaultValue?: string
  /** Available options when variableType is 'enum' */
  enumOptions?: EnumOption[]
  /** Creation timestamp (epoch milliseconds) */
  createdAt: number
}

/** Template content within a pack. Content hash detects modifications from default. */
export interface PackTemplate {
  /** Unique identifier */
  id: string
  /** Pack this template belongs to */
  packId: string
  /** Reference to PROMPT_TEMPLATES[].id */
  templateId: string
  /** Liquid template string */
  content: string
  /** SHA-256 hash of normalized content */
  contentHash: string
  /** Creation timestamp (epoch milliseconds) */
  createdAt: number
  /** Last modification timestamp (epoch milliseconds) */
  updatedAt: number
}

/** Preset pack metadata. Assigned per-story. No versioning — export serves as snapshot. */
export interface PresetPack {
  /** Unique identifier */
  id: string
  /** Pack name (must be unique) */
  name: string
  /** Optional description */
  description: string | null
  /** Optional author attribution */
  author: string | null
  /** Whether this is the built-in default pack */
  isDefault: boolean
  /** Creation timestamp (epoch milliseconds) */
  createdAt: number
  /** Last modification timestamp (epoch milliseconds) */
  updatedAt: number
}

/** Entity types that support runtime variables. */
export type RuntimeEntityType = 'character' | 'location' | 'item' | 'story_beat'

/** Runtime variable data type. No boolean -- only text, number, enum per user decision. */
export type RuntimeVariableType = 'text' | 'number' | 'enum'

/** A runtime variable definition tied to a pack and entity type. */
export interface RuntimeVariable {
  id: string
  packId: string
  entityType: RuntimeEntityType
  variableName: string
  displayName: string
  description?: string
  variableType: RuntimeVariableType
  defaultValue?: string
  minValue?: number
  maxValue?: number
  enumOptions?: EnumOption[]
  color: string
  icon?: string
  pinned: boolean
  sortOrder: number
  createdAt: number
}

/** Per-entity stored value for a runtime variable. Keyed by defId in metadata.runtimeVars. */
export interface RuntimeVariableValue {
  variableName: string
  v: string | number | null
}

/**
 * Shape of runtimeVars inside entity metadata.
 * Keyed by RuntimeVariable.id (defId), NOT by variableName.
 * This makes rename free -- renaming only changes the definition, not the stored values.
 * Locked decision: "Renaming: values follow the rename (linked by ID, not name)."
 */
export type RuntimeVarsMap = Record<string, RuntimeVariableValue>

/** Full pack with all templates and variables. */
export interface FullPack {
  /** Pack metadata */
  pack: PresetPack
  /** All templates in this pack */
  templates: PackTemplate[]
  /** All custom variables in this pack */
  variables: CustomVariable[]
  /** All runtime variable definitions in this pack */
  runtimeVariables?: RuntimeVariable[]
}
