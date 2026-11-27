---
summary: 'Hold sync_suspend for migrations and the app’s own writes; counted, they read every synced item as changed on both devices.'
tags: [persistence]
cross-cutting: false
---

# Automatic writes are not sync edits, and migrations are held from outside

## Context and Problem Statement

Migration 045's triggers count an edit whenever a counted column is written or a story or pack child row changes, and they do not compare values. A write that every device makes alike, without the user doing anything, therefore bumps each device's own counter, and the next sync reads every item it touched as changed on both. The only guard was a rule in 045's comment that each migration insert and delete a `sync_suspend` row itself, which nothing checked. Wrapping each migration's text instead would change its checksum, and `migration_patch.rs` exists because a checksum that drifts stops the app starting. How do automatic writes stay out of the counts, without any migration's text carrying the rule?

## Considered Options

* Hold `sync_suspend` around the whole migration run, from the startup hook and the database service
* Each migration inserts and deletes the row itself, as 045 says
* `migrations()` wraps every migration's SQL, from the next one on
* A test that parses migration SQL for writes to counted tables

## Decision Outcome

Chosen option: "Hold `sync_suspend` around the whole migration run", because it covers every migration, past and future, and leaves no migration's text or checksum different from what is already released.

* **Migrations.** `setup` in `lib.rs` inserts `('migration')` once the checksum patch has run, if the table exists. `DatabaseService.init` deletes it right after `Database.load` returns, before any other statement. Restoring a backup ends in an app exit, so a restored database migrates under the same hold.
* **A migration never manages the row.** An unqualified `DELETE FROM sync_suspend` in a migration would end the hold for the migrations after it. 045's comment saying otherwise predates this decision and cannot be edited.
* **Writes the app makes on its own go through `database.withoutSyncCounting`**, which runs them in one `db_transaction` with the row inserted first and deleted last, so a failure or a crash cannot leave it set. These are the template backfill, the startup sweep of unfinished images, the orphaned-image cleanup, the repair of chapters whose entries are gone, and the clock restored from the branch when a story opens or switches branch. A user's edit never goes through it.
* **Rewrite rows in place.** Deleting and re-inserting a row, or `REPLACE` on a root row, drops its sync identity even under the hold, because the delete triggers ignore it.

### Consequences

* Good, because adding a migration needs nothing from its author, and the rule can no longer be forgotten.
* Good, because the clock restore writes only when the stored clock differs, so opening a story does not touch its counters.
* Bad, because the hold spans two steps in two places, which sync.md rejects for applying an item. It is accepted here because it lasts one startup: `init` deletes the row on the next launch whatever happened to the last.
* Bad, because a database from before 045 has no table to hold when `setup` runs, so the migrations from 045 on run unheld. No identity or vector exists yet, so only `stories.updated_at` can be stamped, once.
* Bad, because nothing checks that a new automatic write uses the helper. A write the app makes on its own that does not is counted, which costs a conflict prompt and never data.

## More Information

[sync.md](../architecture/sync.md), [persistence.md](../architecture/persistence.md).
