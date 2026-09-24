//! Schema guarantees for `time_anchors`.
//!
//! No Rust code reads or writes this table -- the application does it through the SQL
//! plugin. What lives here are the two guarantees the migration makes and the TypeScript
//! side relies on without being able to test: that an anchor cannot outlive its entry, and
//! that an entry cannot carry two.

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::{Row, SqlitePool};

    /// A throwaway database carrying the anchors table and the two parents it references.
    ///
    /// Foreign keys are enabled explicitly, as `database.ts` does on every connection: SQLite
    /// leaves them off by default, and without them the cascade under test never fires.
    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query("CREATE TABLE stories (id TEXT PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE story_entries (
                id TEXT PRIMARY KEY,
                story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        // The migration runs as one script, the way the plugin runs it -- splitting it here
        // would have to reproduce SQLite's comment handling, and the prose contains a
        // semicolon.
        sqlx::raw_sql(include_str!("../migrations/038_time_anchors.sql"))
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO stories (id) VALUES ('s1')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO story_entries (id, story_id) VALUES ('e1', 's1'), ('e2', 's1')")
            .execute(&pool)
            .await
            .unwrap();

        pool
    }

    async fn insert_anchor(pool: &SqlitePool, id: &str, entry: &str, minutes: i64) {
        sqlx::query(
            "INSERT INTO time_anchors (id, story_id, entry_id, asserted_time, note, created_at)
             VALUES (?, 's1', ?, ?, NULL, 1)
             ON CONFLICT(entry_id) DO UPDATE SET asserted_time = excluded.asserted_time",
        )
        .bind(id)
        .bind(entry)
        .bind(format!(
            "{{\"years\":0,\"days\":0,\"hours\":0,\"minutes\":{minutes}}}"
        ))
        .execute(pool)
        .await
        .unwrap();
    }

    async fn anchor_count(pool: &SqlitePool) -> i64 {
        sqlx::query("SELECT COUNT(*) as c FROM time_anchors")
            .fetch_one(pool)
            .await
            .unwrap()
            .get::<i64, _>("c")
    }

    #[tokio::test]
    async fn deleting_an_entry_takes_its_anchor_with_it() {
        let pool = test_pool().await;
        insert_anchor(&pool, "a1", "e1", 30).await;
        insert_anchor(&pool, "a2", "e2", 45).await;

        sqlx::query("DELETE FROM story_entries WHERE id = 'e1'")
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(anchor_count(&pool).await, 1, "e1's anchor should be gone");
        let remaining: String = sqlx::query("SELECT entry_id FROM time_anchors")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get("entry_id");
        assert_eq!(remaining, "e2", "e2's anchor should be untouched");
    }

    #[tokio::test]
    async fn re_anchoring_replaces_rather_than_accumulates() {
        let pool = test_pool().await;
        insert_anchor(&pool, "a1", "e1", 30).await;
        insert_anchor(&pool, "a2", "e1", 90).await;

        assert_eq!(anchor_count(&pool).await, 1, "one anchor per entry");
        let asserted: String = sqlx::query("SELECT asserted_time FROM time_anchors")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get("asserted_time");
        assert!(
            asserted.contains("\"minutes\":90"),
            "the newer assertion should win, got {asserted}"
        );
    }
}
