-- Migration 035: Entry version tracking for conversation re-indexing
-- Stores per-lorebook version counters so the vault assistant can detect
-- external entry edits between chat turns and across sessions.

ALTER TABLE vault_assistant_conversations
  ADD COLUMN entry_versions TEXT NOT NULL DEFAULT '[]';
