//! This installation's identity in the sync tables.

use sqlx::Row;
use sqlx::SqlitePool;
use uuid::Uuid;

/// Gives a restored database a device identity of its own.
///
/// A backup can land on a second device, and a rollback rewinds counters this ID has already
/// used. Vector rows under the old ID stay: they are still history. A backup older than the sync
/// tables has nothing to do here, and gets its ID from the migration.
pub async fn assign_new_device_id(pool: &SqlitePool) -> Result<(), String> {
    let has_table = sqlx::query(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'sync_device'",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| format!("failed to inspect restored database: {e}"))?
    .get::<i64, _>("n")
        > 0;
    if !has_table {
        return Ok(());
    }

    let new_id = Uuid::new_v4().simple().to_string();
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("failed to start device update: {e}"))?;
    let name: Option<String> = sqlx::query_scalar("SELECT name FROM sync_device WHERE is_self = 1")
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| format!("failed to read device: {e}"))?;
    sqlx::query("UPDATE sync_device SET is_self = 0 WHERE is_self = 1")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("failed to retire device: {e}"))?;
    sqlx::query("INSERT INTO sync_device (device_id, name, is_self) VALUES (?, ?, 1)")
        .bind(new_id)
        .bind(name.unwrap_or_default())
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("failed to add device: {e}"))?;
    tx.commit()
        .await
        .map_err(|e| format!("failed to commit device update: {e}"))
}

#[cfg(test)]
mod tests {
    use super::assign_new_device_id;
    use crate::test_db::{memory_pool, run_migrations};
    use sqlx::{Row, SqlitePool};
    use std::collections::{BTreeMap, BTreeSet};

    const NOT_COUNTED: &[&str] = &[
        "world_state_changes",
        "world_state_snapshots",
        "background_images",
        "kept_separate",
    ];

    async fn exec(pool: &SqlitePool, sql: &'static str) {
        sqlx::raw_sql(sql).execute(pool).await.unwrap();
    }

    async fn schema() -> SqlitePool {
        let pool = memory_pool().await;
        run_migrations(&pool, 0, 45).await;
        exec(&pool, "UPDATE sync_device SET device_id = 'me'").await;
        pool
    }

    async fn counter(pool: &SqlitePool, sync_id: &str) -> Option<i64> {
        sqlx::query_scalar("SELECT counter FROM sync_vector WHERE sync_id = ? AND device_id = 'me'")
            .bind(sync_id)
            .fetch_optional(pool)
            .await
            .unwrap()
    }

    async fn count(pool: &SqlitePool, table_sql: &'static str) -> i64 {
        sqlx::query_scalar(table_sql).fetch_one(pool).await.unwrap()
    }

    async fn story_time(pool: &SqlitePool) -> i64 {
        count(pool, "SELECT updated_at FROM stories WHERE id = 's'").await
    }

    async fn synced_character() -> SqlitePool {
        let pool = schema().await;
        exec(
            &pool,
            "INSERT INTO character_vault (id, name, created_at, updated_at) VALUES ('c', 'C', 0, 0);
             INSERT INTO sync_identity VALUES ('character', 'c', 'sc');
             INSERT INTO sync_vector (sync_id, device_id, counter) VALUES ('sc', 'me', 1);",
        )
        .await;
        pool
    }

    async fn synced_story() -> SqlitePool {
        let pool = schema().await;
        exec(
            &pool,
            "INSERT INTO stories (id, title, created_at, updated_at) VALUES ('s', 'S', 0, 0);
             INSERT INTO sync_identity VALUES ('story', 's', 'ss');
             INSERT INTO sync_vector (sync_id, device_id, counter) VALUES ('ss', 'me', 1);",
        )
        .await;
        pool
    }

    #[tokio::test]
    async fn the_migration_creates_one_self_device() {
        let pool = memory_pool().await;
        run_migrations(&pool, 0, 45).await;
        let rows: Vec<String> =
            sqlx::query_scalar("SELECT device_id FROM sync_device WHERE is_self = 1")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].len(), 32);
    }

    #[tokio::test]
    async fn the_backfill_only_moves_stories_forward() {
        let pool = memory_pool().await;
        run_migrations(&pool, 0, 43).await;
        exec(
            &pool,
            "INSERT INTO stories (id, title, created_at, updated_at) VALUES
               ('old', 'Old', 0, 10), ('new', 'New', 0, 500), ('empty', 'Empty', 0, 7);
             INSERT INTO story_entries (id, story_id, type, content, position, created_at) VALUES
               ('a', 'old', 'narration', '', 0, 100),
               ('b', 'old', 'narration', '', 1, 200),
               ('c', 'new', 'narration', '', 0, 100);",
        )
        .await;
        run_migrations(&pool, 43, 45).await;
        let rows = sqlx::query("SELECT id, updated_at FROM stories")
            .fetch_all(&pool)
            .await
            .unwrap();
        let times: BTreeMap<String, i64> = rows
            .iter()
            .map(|r| (r.get("id"), r.get("updated_at")))
            .collect();
        assert_eq!(times["old"], 200);
        assert_eq!(times["new"], 500);
        assert_eq!(times["empty"], 7);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM sync_vector").await, 0);
    }

    #[tokio::test]
    async fn a_portable_column_counts_and_favourite_does_not() {
        let pool = synced_character().await;
        exec(
            &pool,
            "UPDATE character_vault SET description = 'x' WHERE id = 'c'",
        )
        .await;
        assert_eq!(counter(&pool, "sc").await, Some(2));
        exec(
            &pool,
            "UPDATE character_vault SET favorite = 1, updated_at = 5 WHERE id = 'c'",
        )
        .await;
        assert_eq!(counter(&pool, "sc").await, Some(2));
    }

    #[tokio::test]
    async fn an_item_that_never_synced_has_no_sync_rows() {
        let pool = schema().await;
        exec(
            &pool,
            "INSERT INTO scenario_vault (id, name, setting_seed, created_at, updated_at)
               VALUES ('v', 'V', '', 0, 0);
             UPDATE scenario_vault SET name = 'W' WHERE id = 'v';",
        )
        .await;
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM sync_vector").await, 0);
    }

    #[tokio::test]
    async fn deleting_an_item_clears_its_sync_rows() {
        let pool = synced_character().await;
        exec(&pool, "DELETE FROM character_vault WHERE id = 'c'").await;
        assert_eq!(counter(&pool, "sc").await, None);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM sync_identity").await, 0);
    }

    #[tokio::test]
    async fn a_pack_child_write_counts_for_the_pack() {
        let pool = schema().await;
        exec(
            &pool,
            "INSERT INTO preset_packs (id, name, created_at, updated_at) VALUES ('p', 'P', 0, 0);
             INSERT INTO sync_identity VALUES ('pack', 'p', 'sp');
             INSERT INTO sync_vector (sync_id, device_id, counter) VALUES ('sp', 'me', 1);
             INSERT INTO pack_templates
               (id, pack_id, template_id, content, content_hash, created_at, updated_at)
               VALUES ('t', 'p', 'x', '', '', 0, 0);",
        )
        .await;
        assert_eq!(counter(&pool, "sp").await, Some(2));
    }

    #[tokio::test]
    async fn story_content_counts_and_stamps() {
        let pool = synced_story().await;
        exec(
            &pool,
            "INSERT INTO story_entries (id, story_id, type, content, position, created_at)
               VALUES ('e', 's', 'narration', '', 0, 1)",
        )
        .await;
        assert_eq!(counter(&pool, "ss").await, Some(2));
        assert!(story_time(&pool).await > 0);

        exec(&pool, "UPDATE stories SET updated_at = 0").await;
        exec(
            &pool,
            "INSERT INTO characters (id, story_id, name) VALUES ('c', 's', 'C')",
        )
        .await;
        assert_eq!(counter(&pool, "ss").await, Some(3));
        assert!(story_time(&pool).await > 0);
    }

    #[tokio::test]
    async fn a_branch_switch_neither_counts_nor_stamps() {
        let pool = synced_story().await;
        exec(
            &pool,
            "UPDATE stories SET current_branch_id = NULL, retry_state = 'x'",
        )
        .await;
        assert_eq!(counter(&pool, "ss").await, Some(1));
        assert_eq!(story_time(&pool).await, 0);
    }

    #[tokio::test]
    async fn an_unsynced_story_stamps_without_sync_rows() {
        let pool = schema().await;
        exec(
            &pool,
            "INSERT INTO stories (id, title, created_at, updated_at) VALUES ('s', 'S', 0, 0);
             INSERT INTO story_entries (id, story_id, type, content, position, created_at)
               VALUES ('e', 's', 'narration', '', 0, 1);",
        )
        .await;
        assert!(story_time(&pool).await > 0);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM sync_vector").await, 0);
    }

    #[tokio::test]
    async fn sync_suspend_silences_every_trigger() {
        let pool = synced_story().await;
        exec(
            &pool,
            "INSERT INTO sync_suspend VALUES ('test');
             INSERT INTO story_entries (id, story_id, type, content, position, created_at)
               VALUES ('e', 's', 'narration', '', 0, 1);",
        )
        .await;
        assert_eq!(counter(&pool, "ss").await, Some(1));
        assert_eq!(story_time(&pool).await, 0);
    }

    async fn uncovered_tables(pool: &SqlitePool) -> BTreeSet<String> {
        let rows = sqlx::query(
            "SELECT DISTINCT m.name AS name FROM sqlite_master m, pragma_table_info(m.name) c
             WHERE m.type = 'table' AND c.name IN ('story_id', 'pack_id')
               AND m.name != 'stories'",
        )
        .fetch_all(pool)
        .await
        .unwrap();
        let triggers: BTreeSet<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'trigger'")
                .fetch_all(pool)
                .await
                .unwrap()
                .into_iter()
                .collect();
        rows.iter()
            .map(|r| r.get::<String, _>("name"))
            .filter(|t| !NOT_COUNTED.contains(&t.as_str()))
            .filter(|t| {
                !["ins", "upd", "del"]
                    .iter()
                    .all(|op| triggers.contains(&format!("sync_edit_{t}_{op}")))
            })
            .collect()
    }

    #[tokio::test]
    async fn every_story_and_pack_table_is_counted_or_excluded() {
        let pool = schema().await;
        assert_eq!(uncovered_tables(&pool).await, BTreeSet::new());

        exec(&pool, "DROP TRIGGER sync_edit_chapters_del").await;
        assert_eq!(
            uncovered_tables(&pool).await,
            BTreeSet::from(["chapters".to_string()])
        );
    }

    #[tokio::test]
    async fn a_restored_database_gets_a_new_identity() {
        let pool = synced_character().await;
        exec(&pool, "UPDATE sync_device SET name = 'Desk'").await;
        assign_new_device_id(&pool).await.unwrap();

        let row = sqlx::query("SELECT device_id, name FROM sync_device WHERE is_self = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_ne!(row.get::<String, _>("device_id"), "me");
        assert_eq!(row.get::<String, _>("name"), "Desk");
        assert_eq!(counter(&pool, "sc").await, Some(1));
    }

    #[tokio::test]
    async fn a_backup_older_than_the_tables_is_left_alone() {
        let pool = memory_pool().await;
        run_migrations(&pool, 0, 43).await;
        assign_new_device_id(&pool).await.unwrap();
    }
}
