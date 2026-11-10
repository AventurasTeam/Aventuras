import type { Entity } from '@/lib/db'
import { isJsonObject } from '@/lib/json-object'
import { compareId } from '@/lib/list-modules'

// A hand-edited row may hold anything in a JSON column; only strings are read.
export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

export const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export const stateOf = (row: Entity): Readonly<Record<string, unknown>> =>
  isJsonObject(row.state) ? row.state : {}

// Code units, never localeCompare: host locale would make what the model reads device-dependent.
export const byNameThenId = (a: Entity, b: Entity): number =>
  compareId(a.name, b.name) || compareId(a.id, b.id)
